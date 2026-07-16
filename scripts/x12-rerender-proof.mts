#!/usr/bin/env tsx
/**
 * X12 Track A — re-render proof harness (owner-runnable, READ-ONLY DB).
 *
 * Re-renders the known-bad taxonomy pages of a production AVATAR_STORY book
 * (and a photo-book control) with the branch's FIXED illustration prompts on
 * the current provider (Gemini), to prove the Track A fixes:
 *   A4  per-image NAME↔SHEET map (`image N = Grypho, a pet`)
 *   A5  exact-cast constraint (draw each named character once, no strays)
 *   A6  send only the scene's present cast's sheets (selectSceneSheets)
 *   ABSOLUTELY-NO-TEXT rule assembled LAST on interiors
 *   cover: exact title + #F76C5E hex-only (no "Coral" color-name leak)
 *
 * It FAITHFULLY MIRRORS the illustration worker's composition
 * (illustration-generation.worker.ts + cover-generation.ts) but performs NO
 * side effects: no page.update, no book.update, no Cloudinary upload, no
 * Redis/BullMQ. The DB is touched with findUnique/findMany ONLY.
 *
 * Roster note (documented decision): the worker reads Book.characterIdentity
 * from the DB. This prod book predates the roster-composition fixes
 * (buildAvatarStoryRoster), so its stored roster carries placeholder traits and
 * no `species`. This harness reads it AS-IS — the faithful "what a re-render of
 * THIS book on the fixed pipeline produces" test. It does NOT re-compose the
 * roster (that would test a different input than the worker uses).
 *
 * Usage (via `railway run --service workers` for prod DB + GOOGLE_API_KEY):
 *   npx tsx scripts/x12-rerender-proof.mts prep
 *       Read-only. Dumps every candidate FIXED prompt to .screenshots/
 *       x12-a-prompts/ and downloads the EXISTING (old, bad) renders to
 *       .screenshots/x12-a-existing-p{N}.png for content-mapping. ZERO
 *       generate() calls.
 *   npx tsx scripts/x12-rerender-proof.mts render <t1,t2,...>
 *       Renders ONLY the listed targets. Targets:
 *         avatar-title-interior | avatar-cover | avatar-p<N> |
 *         photo-interior | photo-cover
 *       avatar-cover implies avatar-title-interior first (it is the anchor).
 *       --stage1 (X12-D): avatar interiors render name-neutral
 *       (neutralizeCharacterNames) with ZERO style-ref images; outputs are
 *       x12-d-s1-<slug>.png / prompt dumps s1-<slug>.txt, and a preflight
 *       aborts before spend if any roster name leaks into a built prompt.
 *
 * Every generate() call is counted and the total printed at exit.
 */

// Use the workers' own ESM prisma singleton (clean default export, proven in
// prod). Importing `@storywink/database` here hits CJS-interop snags under the
// .mts ESM entry. Read-only use only — findUnique/findMany.
import prisma from '../apps/workers/src/database/index.js';
import pino from 'pino';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import {
  createIllustrationPrompt,
  IllustrationPromptOptions,
} from '@storywink/shared/prompts/illustration';
import { STYLE_LIBRARY, StyleKey } from '@storywink/shared/prompts/styles';
import { optimizeCloudinaryUrlForVision, convertHeicToJpeg } from '@storywink/shared/utils';
import { speciesLineFor, kindFromRole } from '@storywink/shared/prompts/character-identity';
import type { CharacterIdentity } from '@storywink/shared/types';
import type { BridgeScene, AvatarPageScene } from '@storywink/shared/prompts/story';

import { getIllustrator } from '../apps/workers/src/lib/illustrators/index.js';
import type {
  IllustrationImageInput,
  IllustrationInput,
} from '../apps/workers/src/lib/illustrators/index.js';
import { fetchImageInput, resizeForReference } from '../apps/workers/src/lib/images.js';
import { mergeLinkedAvatarSheets } from '../apps/workers/src/lib/avatar-sheets.js';
import {
  orderCharacterSheets,
  selectSceneSheets,
  reconcileSceneCastWithText,
  type SceneCastRosterMember,
  type SceneCastRepair,
} from '../apps/workers/src/lib/avatar-story.js';
import { upscaleForPrint } from '../apps/workers/src/utils/image-processing.js';

/** Track B: the before/after cast + the reconcile repair, for reporting. */
type SceneCastRepairLog = {
  before: string[];
  after: string[];
  repair: SceneCastRepair | null;
};

const AVATAR_BOOK = 'cmrm0yfzd00ymo50dvcnetv1m'; // "Kai and the Wild Rumble", AVATAR_STORY, vignette
const PHOTO_BOOK = 'cmr9u9he8000ypo0dy6zm3i4i'; // "Blocks, Balls & Bumblebee", PHOTO_STORY, vignette

const SCREENSHOTS = path.resolve(process.cwd(), '.screenshots');
const PROMPT_DIR = path.join(SCREENSHOTS, 'x12-a-prompts');

// Optional output label for a validation re-run (render mode only). With
// X12_LABEL=v2 the PNG becomes .screenshots/x12-a-v2-<slug>.png and the prompt
// dump .screenshots/x12-a-prompts/v2-<slug>.txt. Unset preserves the original
// x12-a-<slug> naming. Output-only; the DB path stays read-only.
const LABEL = process.env.X12_LABEL || '';
const pngName = (slug: string) => (LABEL ? `x12-a-${LABEL}-${slug}` : `x12-a-${slug}`);
const promptName = (slug: string) => (LABEL ? `${LABEL}-${slug}` : `x12-a-${slug}`);

// X12 Track D — provider-validation set label. When X12_SET is set (e.g.
// `openai`, `gemini-ga`, `photo-openai`), output PNGs become
// `x12-d-<set>-<slug>.png` and prompt dumps `x12-d-<set>-<slug>.txt`, and every
// render is timed into the machine-readable results JSON. Output-only; the DB
// path stays read-only. Unset preserves the Track A x12-a naming.
const SET = process.env.X12_SET || '';

// X12 Track D — Stage 1 (`--stage1`): the name-neutral + style-ref-diet
// experiment. Avatar interior builds set neutralizeCharacterNames: true and
// send ZERO style-ref images (the style bible text remains); outputs become
// x12-d-s1-<slug>.png and prompt dumps s1-<slug>.txt. Before ANY spend, a
// preflight asserts the built prompt leaks no roster display name — a leak
// aborts the run with zero generate() calls for that page.
const STAGE1 = process.argv.includes('--stage1');

// X12 Track B — scene-cast repair proof (`--repair`). Before selecting sheets
// and building the prompt for an avatar interior, run the branch's
// `reconcileSceneCastWithText` over the page's STORED text + bridgeScene + the
// book's roster: any character the text names but the persisted
// charactersPresent dropped is union-added back. That repaired cast is what
// `selectSceneSheets` and the exact-cast line then see — so the previously
// missing character's SHEET now ships and it is named in the (neutralized under
// --stage1) exact-cast constraint. Outputs are x12-b-<slug>.png / prompt dumps
// x12-b-<slug>.txt (slug `p<N>-repaired`). Combine with --stage1 to match prod
// (neutral names, 0 style-ref images). Output-only; the DB path stays read-only.
const REPAIR = process.argv.includes('--repair');

// X12-D — `--label <name>` (or `--label=<name>`) overrides the Stage 1 output
// prefix (default `s1`). Used for the OPENAI_IMAGE_QUALITY A/B: rendering the
// same Stage 1 pages with `--stage1 --label s1med` writes
// x12-d-s1med-<slug>.png / prompt dumps s1med-<slug>.txt so a medium-quality
// re-render sits BESIDE its high (`s1`) sibling instead of overwriting it.
// Output-only; the DB path stays read-only.
function parseLabel(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--label') return (args[i + 1] || '').trim();
    const eq = a.match(/^--label=(.+)$/);
    if (eq) return eq[1].trim();
  }
  return '';
}
const STAGE1_LABEL = parseLabel(process.argv) || 's1';

const dPng = (slug: string) =>
  REPAIR
    ? `x12-b-${slug}`
    : STAGE1
      ? `x12-d-${STAGE1_LABEL}-${slug}`
      : SET
        ? `x12-d-${SET}-${slug}`
        : pngName(slug);
const dPrompt = (slug: string) =>
  REPAIR
    ? `x12-b-${slug}`
    : STAGE1
      ? `${STAGE1_LABEL}-${slug}`
      : SET
        ? `x12-d-${SET}-${slug}`
        : promptName(slug);
const RESULTS_JSON = path.join(SCREENSHOTS, 'x12-d-results.json');

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

let generateCalls = 0;

// --- D: per-render measurement (latency, outcome, cost inputs) -------------
type RenderRecord = {
  set: string;
  page: string; // pageLabel: 'title' | 'p3' | 'cover' | 'photo-interior' | ...
  provider: string;
  model: string;
  size: string;
  quality?: string; // OpenAI only
  concurrency?: number; // batch width when rendered in a --concurrency pool
  ms: number; // wall-clock of the illustrator.generate() call
  outcome: 'ok' | 'blocked' | 'error';
  blockedReason?: string; // content-policy / safety block (moderation)
  errorStatus?: number; // HTTP status on a thrown error (429 = rate limit)
  errorMessage?: string;
  file?: string; // output PNG basename on success
  timestamp: string;
};
const records: RenderRecord[] = [];

/**
 * Single render with first-class measurement. Times the generate() call,
 * classifies the outcome (ok / blocked / thrown error), saves the PNG on
 * success, and pushes one RenderRecord. Thrown errors (429/backoff/5xx) are
 * CAUGHT and recorded — a concurrent batch keeps going so one page's rate-limit
 * failure is an observation, not a run abort. Returns the image Buffer on
 * success (the cover anchor needs it), else null. Spend still flows through the
 * single counted choke point (countedGenerate).
 */
async function renderOne(opts: {
  pageLabel: string;
  slug: string;
  input: IllustrationInput;
  concurrency?: number;
}): Promise<Buffer | null> {
  const illustrator = getIllustrator();
  const rec: RenderRecord = {
    set: REPAIR ? 'x12-b-repair' : STAGE1 ? STAGE1_LABEL : SET || '(none)',
    page: opts.pageLabel,
    provider: illustrator.name,
    model: illustrator.modelId,
    size: illustrator.name === 'openai' ? '2048x2048' : '2K',
    ...(illustrator.name === 'openai'
      ? { quality: (process.env.OPENAI_IMAGE_QUALITY ?? 'high').toLowerCase() }
      : {}),
    ...(opts.concurrency ? { concurrency: opts.concurrency } : {}),
    ms: 0,
    outcome: 'error',
    timestamp: new Date().toISOString(),
  };
  const started = performance.now();
  try {
    const out = await countedGenerate(opts.pageLabel, opts.input);
    rec.ms = Math.round(performance.now() - started);
    if (out.imageBase64) {
      const name = dPng(opts.slug);
      savePng(name, out.imageBase64);
      rec.outcome = 'ok';
      rec.file = `${name}.png`;
      console.log(`  OK ${opts.pageLabel}: ${rec.ms} ms`);
      records.push(rec);
      flushRecords();
      return Buffer.from(out.imageBase64, 'base64');
    }
    rec.outcome = 'blocked';
    rec.blockedReason = out.blockedReason;
    console.log(`  BLOCKED ${opts.pageLabel} (${rec.ms} ms): ${out.blockedReason}`);
    records.push(rec);
    flushRecords();
    return null;
  } catch (err: any) {
    rec.ms = Math.round(performance.now() - started);
    const status = err?.status ?? err?.response?.status;
    rec.outcome = 'error';
    if (typeof status === 'number') rec.errorStatus = status;
    rec.errorMessage = String(err?.message ?? err);
    console.log(
      `  ERROR ${opts.pageLabel} (${rec.ms} ms, status=${status ?? '?'}): ${rec.errorMessage}`,
    );
    if (status === 429) {
      const retryAfter =
        err?.headers?.['retry-after'] ?? err?.response?.headers?.get?.('retry-after');
      console.log(
        `  >>> RATE LIMIT (429) observed on ${opts.pageLabel}; retry-after=${retryAfter ?? 'n/a'} <<<`,
      );
    }
    records.push(rec);
    flushRecords();
    return null;
  }
}

/** Bounded-concurrency pool: run fn over items, at most n in flight. */
async function runPool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>) {
  let idx = 0;
  const width = Math.max(1, Math.min(n, items.length));
  const lanes = Array.from({ length: width }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  });
  await Promise.all(lanes);
}

// Records already on disk from prior invocations, loaded ONCE. Kept separate
// from this run's `records` so flushRecords() is idempotent — it always writes
// base + records (overwrite, never append), so it is safe to call after every
// render (crash/timeout insurance) without duplicating rows.
let persistedBase: RenderRecord[] | null = null;

/** Idempotent overwrite of the results JSON (base-on-disk + this run's rows). */
function flushRecords(verbose = false) {
  if (records.length === 0) return;
  mkdirSync(SCREENSHOTS, { recursive: true });
  if (persistedBase === null) {
    try {
      const parsed = JSON.parse(readFileSync(RESULTS_JSON, 'utf8'));
      persistedBase = Array.isArray(parsed) ? parsed : [];
    } catch {
      persistedBase = [];
    }
  }
  const merged = [...persistedBase, ...records];
  writeFileSync(RESULTS_JSON, JSON.stringify(merged, null, 2));
  if (verbose)
    console.log(
      `  results -> ${RESULTS_JSON} (this run ${records.length}, total ${merged.length})`,
    );
}

/** The single choke point for real spend. Counts + logs every provider call. */
async function countedGenerate(name: string, input: IllustrationInput) {
  generateCalls += 1;
  const illustrator = getIllustrator();
  console.log(
    `  [generate #${generateCalls}] ${name} on ${illustrator.name}/${illustrator.modelId} ` +
      `(1 content + ${input.characterRefs?.length ?? 0} charRefs + ${input.styleRefs.length} styleRefs)`,
  );
  const out = await illustrator.generate(input);
  return out;
}

/**
 * Stage-1 preflight (zero-spend safety): the whole point of the experiment is
 * that the model never sees a roster display name. If one leaks into a built
 * prompt (roster/name-shape surprise on the real book), ABORT before the
 * generate() call rather than burning a counted render on a broken premise.
 */
function assertNoNameLeak(prompt: string, identity: CharacterIdentity | null, label: string): void {
  if (!STAGE1) return;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = (identity?.characters ?? []).map((c) => c.name || c.characterId).filter(Boolean);
  const leaked = names.filter((n) =>
    new RegExp(`(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`, 'i').test(prompt),
  );
  if (leaked.length > 0) {
    throw new Error(
      `STAGE1 PREFLIGHT FAIL on ${label}: roster name(s) leaked into the prompt: ${leaked.join(', ')} — aborting before any spend`,
    );
  }
}

function savePng(name: string, base64: string) {
  mkdirSync(SCREENSHOTS, { recursive: true });
  const file = path.join(SCREENSHOTS, `${name}.png`);
  writeFileSync(file, Buffer.from(base64, 'base64'));
  console.log(`  saved ${file}`);
}

function savePrompt(name: string, prompt: string) {
  mkdirSync(PROMPT_DIR, { recursive: true });
  const file = path.join(PROMPT_DIR, `${name}.txt`);
  writeFileSync(file, prompt);
  console.log(`  prompt -> ${file} (${prompt.length} chars)`);
}

async function fetchStyleBuffers(urls: string[]): Promise<IllustrationImageInput[]> {
  const out: IllustrationImageInput[] = [];
  for (const u of urls) out.push(await fetchImageInput(u));
  return out;
}

// ---------------------------------------------------------------------------
// Load the avatar book, its roster, pages, and the linked-avatar sheet stack.
// ---------------------------------------------------------------------------
async function loadAvatarBook() {
  const book = await prisma.book.findUnique({
    where: { id: AVATAR_BOOK },
    include: {
      pages: {
        orderBy: { pageNumber: 'asc' },
        select: {
          id: true,
          pageNumber: true,
          index: true,
          isTitlePage: true,
          source: true,
          text: true,
          illustrationNotes: true,
          bridgeScene: true,
          generatedImageUrl: true,
        },
      },
    },
  });
  if (!book) throw new Error('avatar book not found');

  const identity = book.characterIdentity as unknown as CharacterIdentity | null;
  const starId = identity?.characters?.find((c) => c.role?.startsWith('main'))?.characterId ?? null;

  // Track B roster for reconcileSceneCastWithText: {characterId, name} pairs,
  // mirroring the story worker's `rosterForScenes` (built there from
  // avatarInput.cast). For a shipped book the same cast lives on
  // Book.characterIdentity, so we read it AS-IS.
  const rosterForScenes: SceneCastRosterMember[] = (identity?.characters ?? []).map((c) => ({
    characterId: c.characterId,
    name: c.name || c.characterId,
  }));

  // Faithful mirror: the illustration flow's sheet stack = base sheets merged
  // with linked account-avatar sheets. characterReferences is null and
  // CHARACTER_SHEETS_ENABLED does not gate AVATAR_STORY, so base is [] and the
  // stack is the four linked avatar sheets. mergeLinkedAvatarSheets is
  // read-only (findMany).
  const sheetStack = await mergeLinkedAvatarSheets({
    bookId: AVATAR_BOOK,
    userId: book.userId,
    artStyle: book.artStyle,
    bookType: book.bookType,
    base: [],
    logger,
  });

  return { book, identity, starId, rosterForScenes, sheetStack: sheetStack ?? [] };
}

/**
 * Assemble the interior avatar-page render exactly as the worker does, then
 * return { prompt, input }. Shared by taxonomy pages and the title-interior
 * (isTitle picks orderCharacterSheets vs selectSceneSheets, per the worker).
 */
async function buildAvatarInterior(
  ctx: Awaited<ReturnType<typeof loadAvatarBook>>,
  page: {
    id: string;
    pageNumber: number;
    isTitlePage: boolean;
    text: string | null;
    illustrationNotes: string | null;
    bridgeScene: unknown;
  },
) {
  const { identity, starId, sheetStack } = ctx;
  const styleKey = ctx.book.artStyle as StyleKey;
  const styleData = STYLE_LIBRARY[styleKey];

  const storedScene = page.bridgeScene as unknown as AvatarPageScene | BridgeScene | null;

  // Track B (--repair): union-repair the scene cast from the page text BEFORE it
  // drives sheet selection and the exact-cast line — exactly as the story worker
  // now does at persist time (reconcileSceneCastWithText). The stored bad book
  // predates this fix, so its persisted charactersPresent dropped text-named
  // characters; repairing here re-adds them, changing which sheets ship.
  let bridgeScene = storedScene;
  let sceneCastRepair: SceneCastRepairLog | null = null;
  if (
    REPAIR &&
    storedScene &&
    Array.isArray((storedScene as AvatarPageScene).charactersPresent) &&
    !page.isTitlePage
  ) {
    const before = [...(storedScene as AvatarPageScene).charactersPresent];
    const reconciled = reconcileSceneCastWithText(
      storedScene as AvatarPageScene,
      page.text ?? '',
      ctx.rosterForScenes,
    );
    bridgeScene = reconciled.scene;
    sceneCastRepair = {
      before,
      after: [...reconciled.scene.charactersPresent],
      repair: reconciled.repair,
    };
    console.log(
      `  [scene-cast repair p${page.pageNumber}] before=[${before.join(', ')}] ` +
        `after=[${reconciled.scene.charactersPresent.join(', ')}] ` +
        `addedIds=[${reconciled.repair?.addedIds.join(', ') ?? '(none)'}] ` +
        `textNames=[${reconciled.repair?.textNames.join(', ') ?? '(none)'}]`,
    );
  }

  // Worker: title page keeps ALL sheets (feeds the cover); interiors ship only
  // the scene's present cast (+ star floor, cap 4).
  const sheetSources =
    sheetStack.length > 1
      ? page.isTitlePage
        ? orderCharacterSheets(sheetStack, starId)
        : selectSceneSheets(sheetStack, {
            charactersPresent: bridgeScene ? bridgeScene.charactersPresent : null,
            starCharacterId: starId,
          })
      : sheetStack;

  const sheetRefs: IllustrationImageInput[] = [];
  const fetchedSheetMeta: { characterId: string; name: string | null }[] = [];
  for (const s of sheetSources) {
    sheetRefs.push(await fetchImageInput(optimizeCloudinaryUrlForVision(s.url)));
    fetchedSheetMeta.push({ characterId: s.characterId, name: s.name });
  }

  // Stage 1 diet: NO style-ref images (mirrors ILLUSTRATION_STYLE_REFS_MAX=0);
  // the style bible text stays in the prompt as the style truth.
  const styleReferenceUrls = STAGE1
    ? []
    : sheetRefs.length > 0
      ? [...styleData.referenceImageUrls].slice(0, 2)
      : [...styleData.referenceImageUrls];
  const styleReferenceBuffers = await fetchStyleBuffers(styleReferenceUrls);

  // AVATAR_STORY: the FIRST sheet becomes image 1 (the content anchor).
  const contentInput = sheetRefs.shift()!;
  const sheetAnchored = true;

  const sheetRoster = fetchedSheetMeta.map((meta) => {
    const rosterChar = identity?.characters?.find((c) => c.characterId === meta.characterId);
    return {
      name: meta.name || rosterChar?.name || meta.characterId,
      species: speciesLineFor(rosterChar as any, kindFromRole(rosterChar?.role)),
    };
  });

  const promptInput: IllustrationPromptOptions = {
    style: styleKey,
    pageText: page.text,
    bookTitle: ctx.book.title,
    isTitlePage: false,
    illustrationNotes: page.illustrationNotes,
    language: ctx.book.language || 'en',
    referenceImageCount: styleReferenceBuffers.length,
    characterIdentity: identity,
    pageNumber: page.pageNumber,
    qcFeedback: null,
    characterSheetCount: sheetRefs.length,
    bridgeScene: bridgeScene as any,
    contentAnchor: sheetAnchored ? ('sheet' as const) : undefined,
    sheetRoster,
    ...(STAGE1 ? { neutralizeCharacterNames: true } : {}),
  };
  const prompt = createIllustrationPrompt(promptInput);

  const input: IllustrationInput = {
    contentImage: contentInput,
    ...(sheetRefs.length > 0 ? { characterRefs: sheetRefs } : {}),
    styleRefs: styleReferenceBuffers,
    prompt,
  };
  return { prompt, input, contentInput, sheetRefs, sheetRoster, sceneCastRepair };
}

/**
 * Assemble the AVATAR_STORY cover render exactly as
 * illustration-generation.worker.ts (:948-990) + cover-generation.ts do, given
 * the already-rendered title-interior buffer (the cover anchor).
 */
async function buildAvatarCover(
  ctx: Awaited<ReturnType<typeof loadAvatarBook>>,
  titlePage: {
    pageNumber: number;
    text: string | null;
    illustrationNotes: string | null;
  },
  interiorRenderBuffer: Buffer,
) {
  const { identity, starId, sheetStack } = ctx;
  const styleKey = ctx.book.artStyle as StyleKey;
  const styleData = STYLE_LIBRARY[styleKey];

  // Cover keeps ALL cast sheets (title page is exempt from present-cast filter).
  const ordered = orderCharacterSheets(sheetStack, starId);
  const allSheetRefs: IllustrationImageInput[] = [];
  for (const s of ordered)
    allSheetRefs.push(await fetchImageInput(optimizeCloudinaryUrlForVision(s.url)));

  // Worker: interiorRenderBuffer is upscaled for print, then downscaled to a
  // reference; for avatar covers it becomes image 1 (contentAnchor 'interior').
  const upscaled = await upscaleForPrint(interiorRenderBuffer);
  const interiorRenderRef = await resizeForReference(upscaled);
  const contentImage = interiorRenderRef; // avatarCoverAnchor

  // cover-generation.ts: with sheets present, trim cover exemplars to 2.
  const allCoverRefUrls = styleData.coverReferenceImageUrls?.length
    ? [...styleData.coverReferenceImageUrls]
    : [...styleData.referenceImageUrls];
  const coverStyleRefUrls = allSheetRefs.length > 0 ? allCoverRefUrls.slice(0, 2) : allCoverRefUrls;
  const coverRefBuffers = await fetchStyleBuffers(coverStyleRefUrls);

  const coverPromptInput: IllustrationPromptOptions = {
    style: styleKey,
    pageText: titlePage.text,
    bookTitle: ctx.book.title,
    isTitlePage: true,
    illustrationNotes: titlePage.illustrationNotes,
    language: ctx.book.language || 'en',
    referenceImageCount: coverRefBuffers.length,
    characterIdentity: identity,
    pageNumber: titlePage.pageNumber,
    qcFeedback: null,
    characterSheetCount: allSheetRefs.length,
    interiorRenderCount: 0, // avatar covers pass interiorRenderRef: null to the cover call
    contentAnchor: 'interior' as const,
  };
  const prompt = createIllustrationPrompt(coverPromptInput);

  const input: IllustrationInput = {
    contentImage,
    characterRefs: allSheetRefs,
    styleRefs: coverRefBuffers,
    prompt,
  };
  return { prompt, input };
}

// ---------------------------------------------------------------------------
// Photo-book control
// ---------------------------------------------------------------------------
async function loadPhotoBook() {
  const book = await prisma.book.findUnique({
    where: { id: PHOTO_BOOK },
    include: {
      pages: {
        orderBy: { pageNumber: 'asc' },
        select: {
          id: true,
          pageNumber: true,
          isTitlePage: true,
          source: true,
          text: true,
          illustrationNotes: true,
          assetId: true,
          asset: { select: { url: true, thumbnailUrl: true } },
        },
      },
    },
  });
  if (!book) throw new Error('photo book not found');
  const identity = book.characterIdentity as unknown as CharacterIdentity | null;
  const interior = book.pages.find(
    (p) => p.source === 'PHOTO' && !p.isTitlePage && p.illustrationNotes && p.asset?.url,
  );
  const cover = book.pages.find((p) => p.isTitlePage && p.asset?.url);
  return { book, identity, interior, cover };
}

async function buildPhotoInterior(ctx: Awaited<ReturnType<typeof loadPhotoBook>>) {
  const p = ctx.interior!;
  const styleKey = ctx.book.artStyle as StyleKey;
  const styleData = STYLE_LIBRARY[styleKey];
  const url = optimizeCloudinaryUrlForVision(convertHeicToJpeg(p.asset!.url!));
  const contentImage = await fetchImageInput(url);
  const styleRefs = await fetchStyleBuffers([...styleData.referenceImageUrls]); // 0 sheets → all refs

  const promptInput: IllustrationPromptOptions = {
    style: styleKey,
    pageText: p.text,
    bookTitle: ctx.book.title,
    isTitlePage: false,
    illustrationNotes: p.illustrationNotes,
    language: ctx.book.language || 'en',
    referenceImageCount: styleRefs.length,
    characterIdentity: ctx.identity,
    pageNumber: p.pageNumber,
    qcFeedback: null,
    characterSheetCount: 0,
  };
  const prompt = createIllustrationPrompt(promptInput);
  const input: IllustrationInput = { contentImage, styleRefs, prompt };
  return { prompt, input, page: p };
}

async function buildPhotoCover(ctx: Awaited<ReturnType<typeof loadPhotoBook>>) {
  const p = ctx.cover!;
  const styleKey = ctx.book.artStyle as StyleKey;
  const styleData = STYLE_LIBRARY[styleKey];
  const url = optimizeCloudinaryUrlForVision(convertHeicToJpeg(p.asset!.url!));
  const contentImage = await fetchImageInput(url);
  // No sheets on this photo book → cover uses all cover exemplars, contentAnchor 'photo'.
  const coverUrls = styleData.coverReferenceImageUrls?.length
    ? [...styleData.coverReferenceImageUrls]
    : [...styleData.referenceImageUrls];
  const styleRefs = await fetchStyleBuffers(coverUrls);

  const promptInput: IllustrationPromptOptions = {
    style: styleKey,
    pageText: p.text,
    bookTitle: ctx.book.title,
    isTitlePage: true,
    illustrationNotes: p.illustrationNotes,
    language: ctx.book.language || 'en',
    referenceImageCount: styleRefs.length,
    characterIdentity: ctx.identity,
    pageNumber: p.pageNumber,
    qcFeedback: null,
    characterSheetCount: 0,
    interiorRenderCount: 0,
  };
  const prompt = createIllustrationPrompt(promptInput);
  const input: IllustrationInput = { contentImage, styleRefs, prompt };
  return { prompt, input, page: p };
}

async function downloadExisting(name: string, url: string | null) {
  if (!url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(SCREENSHOTS, { recursive: true });
    writeFileSync(path.join(SCREENSHOTS, `${name}.png`), buf);
    console.log(`  existing -> ${name}.png`);
  } catch (e: any) {
    console.log(`  existing download failed (${name}): ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// PREP mode: read-only. Dump prompts + download existing renders. No spend.
// ---------------------------------------------------------------------------
async function prep() {
  console.log('=== PREP (read-only, no generate calls) ===');
  const av = await loadAvatarBook();
  console.log(`Avatar book: "${av.book.title}"  star=${av.starId}  sheets=${av.sheetStack.length}`);
  console.log(`Sheet stack: ${av.sheetStack.map((s) => `${s.characterId}:${s.name}`).join(', ')}`);

  for (const page of av.book.pages) {
    await downloadExisting(`x12-a-existing-p${page.pageNumber}`, page.generatedImageUrl);
    const built = await buildAvatarInterior(av, page);
    const label = page.isTitlePage ? `title-interior-p${page.pageNumber}` : `p${page.pageNumber}`;
    savePrompt(`x12-a-avatar-${label}`, built.prompt);
    console.log(
      `  p${page.pageNumber} roster=[${built.sheetRoster
        .map((r) => `${r.name}:${r.species}`)
        .join(' | ')}]  charRefs=${built.sheetRefs.length}`,
    );
  }

  const ph = await loadPhotoBook();
  console.log(
    `\nPhoto book: "${ph.book.title}"  interior=p${ph.interior?.pageNumber}  cover=p${ph.cover?.pageNumber}`,
  );
  if (ph.interior) savePrompt('x12-a-photo-interior', (await buildPhotoInterior(ph)).prompt);
  if (ph.cover) savePrompt('x12-a-photo-cover', (await buildPhotoCover(ph)).prompt);

  console.log(`\nPREP done. generate() calls: ${generateCalls} (must be 0).`);
}

// ---------------------------------------------------------------------------
// RECONCILE mode (Track B): read-only, ZERO spend. For each listed pageNumber,
// print the page text, the stored charactersPresent, the roster, and the
// reconcileSceneCastWithText diff (before → after, addedIds, textNames). Proves
// which pages the shipped scene cast dropped a text-named character on, and
// exactly what the branch's union-repair restores — WITHOUT any generate() call.
// ---------------------------------------------------------------------------
async function reconcileInspect(pageNumbers: number[]) {
  console.log('=== RECONCILE (read-only, no generate calls) ===');
  const av = await loadAvatarBook();
  console.log(`Avatar book: "${av.book.title}"  star=${av.starId}`);
  console.log(
    `Roster (id:name): ${av.rosterForScenes.map((r) => `${r.characterId}:${r.name}`).join(' | ')}`,
  );
  const pagesByNum = new Map(av.book.pages.map((p) => [p.pageNumber, p]));
  for (const n of pageNumbers) {
    const page = pagesByNum.get(n);
    if (!page) {
      console.log(`\n-- pageNumber ${n}: NOT FOUND --`);
      continue;
    }
    const scene = page.bridgeScene as unknown as AvatarPageScene | null;
    const present = scene?.charactersPresent ?? null;
    console.log(`\n-- pageNumber ${n} (pdf p${2 * n + 2}) --`);
    console.log(`  text: ${JSON.stringify(page.text)}`);
    console.log(
      `  stored charactersPresent: ${present ? `[${present.join(', ')}]` : '(no scene)'}`,
    );
    if (!scene || !Array.isArray(present)) {
      console.log('  no reconcile — page has no structured avatar scene');
      continue;
    }
    const out = reconcileSceneCastWithText(scene, page.text ?? '', av.rosterForScenes);
    console.log(`  after reconcile: [${out.scene.charactersPresent.join(', ')}]`);
    console.log(
      `  repair: ${
        out.repair
          ? `addedIds=[${out.repair.addedIds.join(', ')}] textNames=[${out.repair.textNames.join(', ')}]`
          : 'null (no change)'
      }`,
    );
  }
  console.log(`\nRECONCILE done. generate() calls: ${generateCalls} (must be 0).`);
}

// ---------------------------------------------------------------------------
// RENDER mode: only the explicitly listed targets.
// ---------------------------------------------------------------------------
async function render(targets: string[], concurrency: number) {
  console.log(`=== RENDER targets: ${targets.join(', ')} (concurrency ${concurrency}) ===`);
  const av = await loadAvatarBook();
  const pagesByNum = new Map(av.book.pages.map((p) => [p.pageNumber, p]));
  const titlePage = av.book.pages.find((p) => p.isTitlePage)!;

  // avatar-cover needs the title-interior buffer as its anchor. Title + cover
  // stay strictly sequential (the cover render is anchored on the title render).
  const needTitleInterior =
    targets.includes('avatar-title-interior') || targets.includes('avatar-cover');
  let titleInteriorBuffer: Buffer | null = null;

  if (needTitleInterior) {
    console.log(`\n[avatar-title-interior] p${titlePage.pageNumber}`);
    const built = await buildAvatarInterior(av, titlePage);
    savePrompt(dPrompt('title'), built.prompt);
    assertNoNameLeak(built.prompt, av.identity, 'title');
    titleInteriorBuffer = await renderOne({
      pageLabel: 'title',
      slug: 'title',
      input: built.input,
    });
  }

  if (targets.includes('avatar-cover')) {
    if (!titleInteriorBuffer) {
      console.log('  avatar-cover skipped: title-interior render did not produce an image');
    } else {
      console.log(`\n[avatar-cover]`);
      const built = await buildAvatarCover(av, titlePage, titleInteriorBuffer);
      savePrompt(dPrompt('cover'), built.prompt);
      await renderOne({ pageLabel: 'cover', slug: 'cover', input: built.input });
    }
  }

  // Interior avatar pages — the set that measures per-page latency + rate-limit
  // behavior. Run N-at-a-time so a --concurrency 3 batch mirrors the prod
  // ILLUSTRATION_CONCURRENCY and surfaces any 429/backoff.
  const pageTargets = targets
    .map((t) => t.match(/^avatar-p(\d+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => Number(m[1]));

  if (pageTargets.length > 0) {
    console.log(`\n[avatar interiors] pages=${pageTargets.join(',')} concurrency=${concurrency}`);
    await runPool(pageTargets, concurrency, async (n) => {
      const page = pagesByNum.get(n);
      if (!page) {
        console.log(`  avatar-p${n}: page not found`);
        return;
      }
      const built = await buildAvatarInterior(av, page);
      const slug = REPAIR ? `p${n}-repaired` : SET || STAGE1 ? `p${n}` : (TAXO[n] ?? `p${n}`);
      savePrompt(dPrompt(slug), built.prompt);
      assertNoNameLeak(built.prompt, av.identity, `p${n}`);
      await renderOne({
        pageLabel: `p${n}`,
        slug,
        input: built.input,
        ...(concurrency > 1 ? { concurrency } : {}),
      });
    });
  }

  const unknown = targets.filter(
    (t) =>
      t !== 'avatar-title-interior' &&
      t !== 'avatar-cover' &&
      t !== 'photo-interior' &&
      t !== 'photo-cover' &&
      !/^avatar-p\d+$/.test(t),
  );
  for (const t of unknown) console.log(`  unknown target: ${t}`);

  if (targets.includes('photo-interior') || targets.includes('photo-cover')) {
    const ph = await loadPhotoBook();
    if (targets.includes('photo-interior')) {
      console.log(`\n[photo-interior] p${ph.interior?.pageNumber}`);
      const built = await buildPhotoInterior(ph);
      savePrompt(dPrompt('photo-interior'), built.prompt);
      // D5 refusal check: a moderation block here is the data point, NOT a retry
      // candidate. renderOne records blockedReason; do not re-invoke.
      await renderOne({ pageLabel: 'photo-interior', slug: 'photo-interior', input: built.input });
    }
    if (targets.includes('photo-cover')) {
      console.log(`\n[photo-cover] p${ph.cover?.pageNumber}`);
      const built = await buildPhotoCover(ph);
      savePrompt(dPrompt('photo-cover'), built.prompt);
      await renderOne({ pageLabel: 'photo-cover', slug: 'photo-cover', input: built.input });
    }
  }

  flushRecords(true);
  console.log(`\nRENDER done. Total generate() calls this run: ${generateCalls}.`);
}

// Taxonomy mapping (confirmed by reading the existing bad renders): the shipped
// PDF page ref → the Page.pageNumber that produced it (pdf = 2*pageNumber + 2).
//   pdf p8  scaffold-caption  = pageNumber 3
//   pdf p10 double-Kai        = pageNumber 4
//   pdf p18 Grypho→griffin    = pageNumber 8
//   pdf p22 Trapjaw×T-Rex      = pageNumber 10
// File basenames use the pdf ref + slug, per the brief (e.g. x12-a-p18-grypho).
const TAXO: Record<number, string> = {
  3: 'p8-scaffold',
  4: 'p10-double-kai',
  8: 'p18-grypho',
  10: 'p22-trapjaw-trex',
};

/** Parse `--concurrency N` / `--concurrency=N` (else X12_CONCURRENCY, else 1). */
function parseConcurrency(args: string[]): number {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--concurrency') return Math.max(1, parseInt(args[i + 1] || '1', 10) || 1);
    const eq = a.match(/^--concurrency=(\d+)$/);
    if (eq) return Math.max(1, parseInt(eq[1], 10));
  }
  return Math.max(1, parseInt(process.env.X12_CONCURRENCY || '1', 10) || 1);
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'prep') {
    await prep();
  } else if (mode === 'reconcile') {
    // `reconcile <n1,n2,...>` — zero-spend Track B cast-repair inspection.
    const arg = process.argv.slice(3).find((a) => !a.startsWith('--')) || '5,7';
    const pageNumbers = arg
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
    await reconcileInspect(pageNumbers);
  } else if (mode === 'render') {
    const rest = process.argv.slice(3);
    // First non-flag arg is the comma-separated target list.
    const targetArg = rest.find((a) => !a.startsWith('--')) || '';
    const targets = targetArg
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (targets.length === 0) {
      console.error('render mode needs a comma-separated target list');
      process.exit(1);
    }
    const concurrency = parseConcurrency(rest);
    await render(targets, concurrency);
  } else {
    console.error(
      'Usage: x12-rerender-proof.ts <prep | reconcile <pageNums> | ' +
        'render <targets> [--concurrency N] [--stage1] [--repair]>',
    );
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n[SPEND] total generate() calls: ${generateCalls}`);
  });
