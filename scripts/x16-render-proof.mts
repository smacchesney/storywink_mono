#!/usr/bin/env tsx
/**
 * X16 Wave 1 — render proof harness (owner-runnable, READ-ONLY DB).
 *
 * Proves the Wave 1 photo-path render changes on a REAL outing book, on the
 * current provider, WITHOUT any side effects (no page.update, no book.update,
 * no Cloudinary upload, no Redis/BullMQ — the DB is touched with findUnique
 * ONLY). It faithfully mirrors the illustration worker's photo-interior
 * composition (illustration-generation.worker.ts) and the character-sheet
 * composition (lib/character-sheets.ts).
 *
 * For each requested page it renders TWO images with the SAME current code,
 * toggling ONLY the two X16 W1 photo-path flags:
 *   OFF  — PHOTO_COME_ALIVE_ENABLED unset + STORY_ILLUS_MOOD_ENABLED unset
 *          (today's render: scene anchor stays, but no mood cue, no come-alive)
 *   ON   — both `true` (mood cue + one bounded liveliness directive added)
 * The scene anchor (perception {setting, action}) is NOT one of the toggled
 * flags — it is present in BOTH variants when the analysis row is fresh, so the
 * pair isolates mood + come-alive against an otherwise identical prompt. The
 * flags are read at prompt-assembly time from process.env by the same helpers
 * the worker uses (storyIllusMoodEnabled / photoComeAliveEnabled), so this
 * script sets process.env per variant BEFORE assembling the prompt.
 *
 * It also renders ONE character sheet for a NON-CHILD roster subject
 * (grandparent or pet) with the Task 9 sheet prompt (subjectKind + subjectAnchor)
 * to prove the sheet renders that subject age-true and single-subject.
 *
 * Usage (via `railway run --service workers` for prod DB + provider key):
 *   railway run -s workers -- npx tsx scripts/x16-render-proof.mts \
 *       --book <bookId> --pages 3,5
 *
 * Outputs (.screenshots/):
 *   x16-w1-p<N>-off.png / x16-w1-p<N>-on.png   — the A/B interior pair per page
 *   x16-w1-sheet-<role>.png                    — the non-child character sheet
 *   x16-w1-prompts/{off,on}-p<N>.txt           — the exact prompt behind each PNG
 *   x16-w1-prompts/sheet-<role>.txt            — the sheet prompt
 *
 * Every generate() call is counted and the total printed at exit.
 */

// Use the workers' own ESM prisma singleton (clean default export, proven in
// prod). Importing `@storywink/database` here hits CJS-interop snags under the
// .mts ESM entry. Read-only use only — findUnique.
import prisma from '../apps/workers/src/database/index.js';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import {
  createIllustrationPrompt,
  IllustrationPromptOptions,
} from '@storywink/shared/prompts/illustration';
import { STYLE_LIBRARY, StyleKey, getStyleBible } from '@storywink/shared/prompts/styles';
import { createCharacterSheetPrompt } from '@storywink/shared/prompts/character-identity';
import { optimizeCloudinaryUrlForVision, convertHeicToJpeg } from '@storywink/shared/utils';
import type { CharacterIdentity, CharacterDescription } from '@storywink/shared/types';

import { getIllustrator } from '../apps/workers/src/lib/illustrators/index.js';
import type {
  IllustrationImageInput,
  IllustrationInput,
} from '../apps/workers/src/lib/illustrators/index.js';
import { fetchImageInput } from '../apps/workers/src/lib/images.js';
import {
  storyIllusMoodEnabled,
  photoComeAliveEnabled,
} from '../apps/workers/src/lib/story-quality.js';
import {
  resolveCharacterPhotoUrls,
  sheetSubjectKind,
  subjectAnchorFor,
  STYLE_EXEMPLARS_FOR_SHEET,
} from '../apps/workers/src/lib/character-sheets.helpers.js';

const SCREENSHOTS = path.resolve(process.cwd(), '.screenshots');
const PROMPT_DIR = path.join(SCREENSHOTS, 'x16-w1-prompts');

let generateCalls = 0;

/** The single choke point for real spend. Counts + logs every provider call. */
async function countedGenerate(name: string, input: IllustrationInput) {
  generateCalls += 1;
  const illustrator = getIllustrator();
  console.log(
    `  [generate #${generateCalls}] ${name} on ${illustrator.name}/${illustrator.modelId} ` +
      `(1 content + ${input.characterRefs?.length ?? 0} charRefs + ${input.styleRefs.length} styleRefs)`,
  );
  return illustrator.generate(input);
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

/** `--flag value` or `--flag=value`. */
function parseArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) return args[i + 1];
    const m = args[i].match(new RegExp(`^${name}=(.+)$`));
    if (m) return m[1];
  }
  return undefined;
}

/** OFF unsets both flags; ON sets both to 'true'. Read at prompt-build time. */
function applyFlags(variant: 'off' | 'on') {
  if (variant === 'on') {
    process.env.PHOTO_COME_ALIVE_ENABLED = 'true';
    process.env.STORY_ILLUS_MOOD_ENABLED = 'true';
  } else {
    delete process.env.PHOTO_COME_ALIVE_ENABLED;
    delete process.env.STORY_ILLUS_MOOD_ENABLED;
  }
}

type ProofPage = {
  id: string;
  pageNumber: number;
  isTitlePage: boolean;
  source: string;
  text: string | null;
  illustrationNotes: string | null;
  illustrationMood: string | null;
  analysis: unknown;
  assetId: string | null;
  asset: { url: string | null; thumbnailUrl: string | null } | null;
};

type ProofBook = {
  title: string | null;
  language: string | null;
  bookType: string;
  artStyle: string;
  identity: CharacterIdentity | null;
};

/**
 * Assemble the photo-interior render EXACTLY as the worker does for a photo
 * page (illustration-generation.worker.ts :644-712), reading the two X16 W1
 * flags from process.env at assembly time. No character sheets ride here (the
 * standard outing photo render): styleRefs are the full style exemplars.
 */
async function buildPhotoInterior(page: ProofPage, book: ProofBook) {
  const styleKey = book.artStyle as StyleKey;
  const styleData = STYLE_LIBRARY[styleKey];

  const rawUrl = page.asset?.url || page.asset?.thumbnailUrl;
  if (!rawUrl) throw new Error(`page ${page.pageNumber} has no asset url`);
  const contentImage = await fetchImageInput(
    optimizeCloudinaryUrlForVision(convertHeicToJpeg(rawUrl)),
  );
  const styleRefs = await fetchStyleBuffers([...styleData.referenceImageUrls]);

  const isBridgePage = page.source === 'BRIDGE';
  const isAvatarBook = book.bookType === 'AVATAR_STORY';

  // Freshness gate (worker :652): only an analysis row whose assetId still
  // matches the page's current asset may anchor the scene.
  const pageAnalysisRaw = page.analysis as {
    assetId?: string;
    setting?: string;
    action?: string;
  } | null;
  const freshPageAnalysis =
    pageAnalysisRaw && page.assetId && pageAnalysisRaw.assetId === page.assetId
      ? pageAnalysisRaw
      : null;

  const promptInput: IllustrationPromptOptions = {
    style: styleKey,
    pageText: page.text,
    bookTitle: book.title,
    isTitlePage: false,
    illustrationNotes: page.illustrationNotes,
    language: book.language || 'en',
    referenceImageCount: styleRefs.length,
    characterIdentity: book.identity,
    pageNumber: page.pageNumber,
    qcFeedback: null,
    characterSheetCount: 0,
    // STORY_ILLUS_MOOD_ENABLED (read live from process.env per variant).
    ...(storyIllusMoodEnabled() && !isBridgePage && !isAvatarBook && page.illustrationMood
      ? { illustrationMood: page.illustrationMood }
      : {}),
    // X16 W1 scene anchor — present in BOTH variants when the row is fresh.
    ...(freshPageAnalysis && !isBridgePage && !isAvatarBook
      ? {
          sceneAnchor: {
            setting: freshPageAnalysis.setting ?? '',
            action: freshPageAnalysis.action ?? '',
          },
        }
      : {}),
    // PHOTO_COME_ALIVE_ENABLED (read live from process.env per variant).
    photoComeAlive: photoComeAliveEnabled() && !isBridgePage && !isAvatarBook,
  };
  const prompt = createIllustrationPrompt(promptInput);
  const input: IllustrationInput = { contentImage, styleRefs, prompt };
  return {
    prompt,
    input,
    isBridgePage,
    hasMood: !!page.illustrationMood,
    freshAnchor: !!freshPageAnalysis,
  };
}

/** Render one page's OFF/ON pair. */
async function renderPagePair(page: ProofPage, book: ProofBook) {
  console.log(`\n[page ${page.pageNumber}] source=${page.source} title=${page.isTitlePage}`);
  for (const variant of ['off', 'on'] as const) {
    applyFlags(variant);
    const built = await buildPhotoInterior(page, book);
    if (variant === 'off') {
      if (built.isBridgePage)
        console.log(
          `  NOTE: page ${page.pageNumber} is a BRIDGE page — mood/come-alive/anchor never emit; the pair will look identical`,
        );
      if (!built.hasMood)
        console.log(
          `  NOTE: page ${page.pageNumber} has no illustrationMood — the ON prompt gains come-alive only`,
        );
      if (!built.freshAnchor)
        console.log(
          `  NOTE: page ${page.pageNumber} has no fresh analysis row — no scene anchor in either variant`,
        );
    }
    savePrompt(`${variant}-p${page.pageNumber}`, built.prompt);
    const out = await countedGenerate(`p${page.pageNumber} (${variant})`, built.input);
    if (out.imageBase64) savePng(`x16-w1-p${page.pageNumber}-${variant}`, out.imageBase64);
    else console.log(`  BLOCKED p${page.pageNumber} (${variant}): ${out.blockedReason}`);
  }
}

/** kebab-case a role for a filename slug. */
function slug(role: string): string {
  return (role || 'subject')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Render ONE character sheet for a non-child roster subject (Task 9 prompt).
 * Mirrors lib/character-sheets.ts generateAndValidateSheet's composition, minus
 * upload/validation (read-only, no side effects).
 */
async function renderNonChildSheet(pages: ProofPage[], book: ProofBook) {
  const characters = book.identity?.characters ?? [];
  // Prefer an explicit grandparent/pet role; otherwise any non-child subject.
  const preferred = characters.find((c) => {
    const r = (c.role || '').toLowerCase();
    return r === 'pet' || r === 'grandparent';
  });
  const subject: CharacterDescription | undefined =
    preferred ?? characters.find((c) => sheetSubjectKind(c.role) !== 'child');

  if (!subject) {
    console.log('\n[sheet] no non-child roster subject — skipping sheet render');
    return;
  }
  const kind = sheetSubjectKind(subject.role);
  console.log(
    `\n[sheet] subject "${subject.name ?? subject.characterId}" role=${subject.role} kind=${kind}`,
  );

  const photoUrls = resolveCharacterPhotoUrls(
    subject,
    pages.map((p) => ({ assetId: p.assetId, asset: p.asset })),
  );
  if (photoUrls.length === 0) {
    console.log('  no resolvable source photo for this subject — skipping sheet render');
    return;
  }
  const photos = await Promise.all(photoUrls.map((u) => fetchImageInput(u)));

  const styleKey = book.artStyle as StyleKey;
  const styleExemplarUrls = STYLE_LIBRARY[styleKey].referenceImageUrls.slice(
    0,
    STYLE_EXEMPLARS_FOR_SHEET,
  );
  const styleExemplars = await fetchStyleBuffers(styleExemplarUrls);

  const prompt = createCharacterSheetPrompt({
    character: subject,
    photoCount: photos.length,
    styleRefCount: styleExemplars.length,
    styleBible: getStyleBible(styleKey),
    subjectKind: kind,
    subjectAnchor: subjectAnchorFor(subject),
  });
  savePrompt(`sheet-${slug(subject.role)}`, prompt);

  const out = await countedGenerate(`sheet ${subject.role}`, {
    contentImage: photos[0],
    characterRefs: photos.slice(1),
    styleRefs: styleExemplars,
    prompt,
  });
  if (out.imageBase64) savePng(`x16-w1-sheet-${slug(subject.role)}`, out.imageBase64);
  else console.log(`  BLOCKED sheet ${subject.role}: ${out.blockedReason}`);
}

async function main() {
  const bookId = parseArg('--book');
  const pagesArg = parseArg('--pages');
  if (!bookId || !pagesArg) {
    console.error('Usage: x16-render-proof.mts --book <bookId> --pages 3,5');
    process.exit(1);
  }
  const pageNumbers = pagesArg
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  if (pageNumbers.length === 0) {
    console.error('--pages needs a comma-separated list of page numbers');
    process.exit(1);
  }

  const bookRow = await prisma.book.findUnique({
    where: { id: bookId },
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
          illustrationMood: true,
          analysis: true,
          assetId: true,
          asset: { select: { url: true, thumbnailUrl: true } },
        },
      },
    },
  });
  if (!bookRow) throw new Error(`book ${bookId} not found`);
  if (bookRow.bookType === 'AVATAR_STORY') {
    throw new Error('x16-render-proof is for PHOTO outing books — this book is AVATAR_STORY');
  }
  if (!bookRow.artStyle) throw new Error(`book ${bookId} has no artStyle`);

  const book: ProofBook = {
    title: bookRow.title,
    language: bookRow.language,
    bookType: bookRow.bookType,
    artStyle: bookRow.artStyle,
    identity: bookRow.characterIdentity as unknown as CharacterIdentity | null,
  };
  console.log(
    `[x16-proof] book ${bookId} "${bookRow.title}" (${bookRow.bookType}, style ${bookRow.artStyle}, ${bookRow.pages.length} pages)`,
  );

  const pagesByNum = new Map(bookRow.pages.map((p) => [p.pageNumber, p as ProofPage]));
  for (const n of pageNumbers) {
    const page = pagesByNum.get(n);
    if (!page) {
      console.log(`\n[page ${n}] NOT FOUND — skipping`);
      continue;
    }
    await renderPagePair(page, book);
  }

  await renderNonChildSheet(bookRow.pages as ProofPage[], book);

  console.log(`\n[x16-proof] done. Total generate() calls this run: ${generateCalls}.`);
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
