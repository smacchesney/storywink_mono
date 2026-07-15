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
 *
 * Every generate() call is counted and the total printed at exit.
 */

// Use the workers' own ESM prisma singleton (clean default export, proven in
// prod). Importing `@storywink/database` here hits CJS-interop snags under the
// .mts ESM entry. Read-only use only — findUnique/findMany.
import prisma from '../apps/workers/src/database/index.js';
import pino from 'pino';
import { writeFileSync, mkdirSync } from 'fs';
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
import { orderCharacterSheets, selectSceneSheets } from '../apps/workers/src/lib/avatar-story.js';
import { upscaleForPrint } from '../apps/workers/src/utils/image-processing.js';

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

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

let generateCalls = 0;

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

  return { book, identity, starId, sheetStack: sheetStack ?? [] };
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

  const bridgeScene = page.bridgeScene as unknown as AvatarPageScene | BridgeScene | null;

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

  const styleReferenceUrls =
    sheetRefs.length > 0
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
  };
  const prompt = createIllustrationPrompt(promptInput);

  const input: IllustrationInput = {
    contentImage: contentInput,
    ...(sheetRefs.length > 0 ? { characterRefs: sheetRefs } : {}),
    styleRefs: styleReferenceBuffers,
    prompt,
  };
  return { prompt, input, contentInput, sheetRefs, sheetRoster };
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
  for (const s of ordered) allSheetRefs.push(await fetchImageInput(optimizeCloudinaryUrlForVision(s.url)));

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
  console.log(`\nPhoto book: "${ph.book.title}"  interior=p${ph.interior?.pageNumber}  cover=p${ph.cover?.pageNumber}`);
  if (ph.interior) savePrompt('x12-a-photo-interior', (await buildPhotoInterior(ph)).prompt);
  if (ph.cover) savePrompt('x12-a-photo-cover', (await buildPhotoCover(ph)).prompt);

  console.log(`\nPREP done. generate() calls: ${generateCalls} (must be 0).`);
}

// ---------------------------------------------------------------------------
// RENDER mode: only the explicitly listed targets.
// ---------------------------------------------------------------------------
async function render(targets: string[]) {
  console.log(`=== RENDER targets: ${targets.join(', ')} ===`);
  const av = await loadAvatarBook();
  const pagesByNum = new Map(av.book.pages.map((p) => [p.pageNumber, p]));
  const titlePage = av.book.pages.find((p) => p.isTitlePage)!;

  // avatar-cover needs the title-interior buffer as its anchor.
  const needTitleInterior =
    targets.includes('avatar-title-interior') || targets.includes('avatar-cover');
  let titleInteriorBuffer: Buffer | null = null;

  if (needTitleInterior) {
    console.log(`\n[avatar-title-interior] p${titlePage.pageNumber}`);
    const built = await buildAvatarInterior(av, titlePage);
    savePrompt(promptName('title-interior'), built.prompt);
    const out = await countedGenerate('avatar-title-interior', built.input);
    if (out.imageBase64) {
      savePng(pngName('title-interior'), out.imageBase64);
      titleInteriorBuffer = Buffer.from(out.imageBase64, 'base64');
    } else {
      console.log(`  BLOCKED: ${out.blockedReason}`);
    }
  }

  for (const t of targets) {
    if (t === 'avatar-title-interior') continue; // handled above
    if (t === 'avatar-cover') {
      if (!titleInteriorBuffer) {
        console.log('  avatar-cover skipped: title-interior render did not produce an image');
        continue;
      }
      console.log(`\n[avatar-cover]`);
      const built = await buildAvatarCover(av, titlePage, titleInteriorBuffer);
      savePrompt(promptName('cover'), built.prompt);
      const out = await countedGenerate('avatar-cover', built.input);
      if (out.imageBase64) savePng(pngName('cover'), out.imageBase64);
      else console.log(`  BLOCKED: ${out.blockedReason}`);
      continue;
    }
    const m = t.match(/^avatar-p(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      const page = pagesByNum.get(n);
      if (!page) {
        console.log(`  avatar-p${n}: page not found`);
        continue;
      }
      console.log(`\n[avatar-p${n}]`);
      const built = await buildAvatarInterior(av, page);
      const slug = TAXO[n] ?? `p${n}`;
      savePrompt(promptName(slug), built.prompt);
      const out = await countedGenerate(`avatar-p${n}`, built.input);
      if (out.imageBase64) savePng(pngName(slug), out.imageBase64);
      else console.log(`  BLOCKED: ${out.blockedReason}`);
      continue;
    }
    if (t === 'photo-interior' || t === 'photo-cover') continue; // handled below
    console.log(`  unknown target: ${t}`);
  }

  if (targets.includes('photo-interior') || targets.includes('photo-cover')) {
    const ph = await loadPhotoBook();
    if (targets.includes('photo-interior')) {
      console.log(`\n[photo-interior] p${ph.interior?.pageNumber}`);
      const built = await buildPhotoInterior(ph);
      savePrompt('x12-a-photo-interior', built.prompt);
      const out = await countedGenerate('photo-interior', built.input);
      if (out.imageBase64) savePng('x12-a-photo-interior', out.imageBase64);
      else console.log(`  BLOCKED: ${out.blockedReason}`);
    }
    if (targets.includes('photo-cover')) {
      console.log(`\n[photo-cover] p${ph.cover?.pageNumber}`);
      const built = await buildPhotoCover(ph);
      savePrompt('x12-a-photo-cover', built.prompt);
      const out = await countedGenerate('photo-cover', built.input);
      if (out.imageBase64) savePng('x12-a-photo-cover', out.imageBase64);
      else console.log(`  BLOCKED: ${out.blockedReason}`);
    }
  }

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

async function main() {
  const mode = process.argv[2];
  if (mode === 'prep') {
    await prep();
  } else if (mode === 'render') {
    const targets = (process.argv[3] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (targets.length === 0) {
      console.error('render mode needs a comma-separated target list');
      process.exit(1);
    }
    await render(targets);
  } else {
    console.error('Usage: x12-rerender-proof.ts <prep|render <targets>>');
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
