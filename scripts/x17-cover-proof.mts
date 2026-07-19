#!/usr/bin/env tsx
/**
 * X17 Wave A — composed-cover + ensemble proof harness (owner-runnable,
 * READ-ONLY DB: findUnique/findMany only; renders save locally, nothing
 * uploads or persists).
 *
 * For the given REAL outing book it renders:
 *   1. the cover PAIR — legacy (title/first-photo-anchored, today's prompt)
 *      vs composed (hero refs + COVER COMPOSITION + style anchor + sheets)
 *   2. with --ensemble: up to 4 member sheets (selectSheetCharacters with a
 *      simulated all-members cast)
 *   3. regenerated PDFs simulating the composed/ensemble book state:
 *      Lulu interior (coverAssetId nulled), Lulu cover, user export
 *      (synthetic page-0 title page) — best-effort, skipped with a note when
 *      puppeteer/fonts are unavailable in this environment.
 *
 * Usage: railway run -s workers -- npx tsx scripts/x17-cover-proof.mts \
 *          --book <bookId> [--ensemble]
 */

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
import type { CharacterIdentity } from '@storywink/shared/types';
import { getIllustrator } from '../apps/workers/src/lib/illustrators/index.js';
import type {
  IllustrationImageInput,
  IllustrationInput,
} from '../apps/workers/src/lib/illustrators/index.js';
import { fetchImageInput, resizeForReference } from '../apps/workers/src/lib/images.js';
import {
  resolveCharacterPhotoUrls,
  selectSheetCharacters,
  sheetSubjectKind,
  subjectAnchorFor,
  sheetRefsForStyle,
  sheetCapFor,
  STYLE_EXEMPLARS_FOR_SHEET,
} from '../apps/workers/src/lib/character-sheets.helpers.js';
import {
  resolveHeroAssetIds,
  selectStyleAnchorPage,
  starredCharacterIds,
} from '../apps/workers/src/lib/composed-cover.helpers.js';

const SCREENSHOTS = path.resolve(process.cwd(), '.screenshots');
const PROMPT_DIR = path.join(SCREENSHOTS, 'x17-prompts');

let generateCalls = 0;
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
  writeFileSync(path.join(SCREENSHOTS, `${name}.png`), Buffer.from(base64, 'base64'));
  console.log(`  saved .screenshots/${name}.png`);
}
function savePrompt(name: string, prompt: string) {
  mkdirSync(PROMPT_DIR, { recursive: true });
  writeFileSync(path.join(PROMPT_DIR, `${name}.txt`), prompt);
  console.log(`  prompt -> .screenshots/x17-prompts/${name}.txt (${prompt.length} chars)`);
}
function parseArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) return args[i + 1];
    const m = args[i].match(new RegExp(`^${name}=(.+)$`));
    if (m) return m[1];
  }
  return undefined;
}
const hasFlag = (name: string) => process.argv.slice(2).includes(name);

async function fetchRefs(urls: string[]): Promise<IllustrationImageInput[]> {
  const out: IllustrationImageInput[] = [];
  for (const u of urls) out.push(await fetchImageInput(u));
  return out;
}

async function main() {
  const bookId = parseArg('--book');
  if (!bookId) {
    console.error('Usage: x17-cover-proof.mts --book <bookId> [--ensemble]');
    process.exit(1);
  }
  const simulateEnsemble = hasFlag('--ensemble');

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: {
      pages: {
        orderBy: { pageNumber: 'asc' },
        include: { asset: { select: { url: true, thumbnailUrl: true } } },
      },
    },
  });
  if (!book) throw new Error(`book ${bookId} not found`);
  if (book.bookType === 'AVATAR_STORY')
    throw new Error('x17-cover-proof is for PHOTO outing books');
  if (!book.artStyle) throw new Error(`book ${bookId} has no artStyle`);
  const styleKey = book.artStyle as StyleKey;
  const identity = book.characterIdentity as unknown as CharacterIdentity | null;
  console.log(
    `[x17-proof] book ${bookId} "${book.title}" (${book.pages.length} pages, ${styleKey})`,
  );

  // Simulated cast state: --ensemble stars every roster member with photos.
  const memberIds = simulateEnsemble
    ? (identity?.characters ?? []).map((c) => c.characterId)
    : null;
  const starredIds = simulateEnsemble && memberIds?.length ? memberIds : starredCharacterIds(book);

  // Shared reference stack pieces.
  const styleData = STYLE_LIBRARY[styleKey];
  const coverStyleUrls = (
    styleData.coverReferenceImageUrls?.length
      ? [...styleData.coverReferenceImageUrls]
      : [...styleData.referenceImageUrls]
  ).slice(0, 2);
  const styleRefs = await fetchRefs(coverStyleUrls);
  const sheets = sheetRefsForStyle(
    book.characterReferences,
    book.artStyle,
    identity,
    sheetCapFor(memberIds),
  );
  const sheetRefs = await fetchRefs(sheets.map((s) => optimizeCloudinaryUrlForVision(s.url)));

  // ---- 1a. LEGACY cover: first/title photo anchored, today's prompt ----
  const legacyAnchorPage =
    book.pages.find((p) => p.assetId === book.coverAssetId) ?? book.pages.find((p) => p.assetId);
  const legacyUrl = legacyAnchorPage?.asset?.url || legacyAnchorPage?.asset?.thumbnailUrl;
  if (!legacyUrl) throw new Error('no photo to anchor the legacy cover');
  const legacyContent = await fetchImageInput(
    optimizeCloudinaryUrlForVision(convertHeicToJpeg(legacyUrl)),
  );
  const legacyPrompt = createIllustrationPrompt({
    style: styleKey,
    pageText: legacyAnchorPage?.text ?? '',
    bookTitle: book.title,
    isTitlePage: true,
    illustrationNotes: legacyAnchorPage?.illustrationNotes ?? null,
    language: book.language || 'en',
    referenceImageCount: styleRefs.length,
    characterIdentity: identity,
    pageNumber: legacyAnchorPage?.pageNumber ?? 1,
    qcFeedback: null,
    characterSheetCount: sheetRefs.length,
    interiorRenderCount: 0,
  } satisfies IllustrationPromptOptions);
  savePrompt('cover-legacy', legacyPrompt);
  const legacyOut = await countedGenerate('cover (legacy)', {
    contentImage: legacyContent,
    characterRefs: sheetRefs,
    styleRefs,
    prompt: legacyPrompt,
  });
  if (legacyOut.imageBase64) savePng('x17-cover-legacy', legacyOut.imageBase64);
  else console.log(`  BLOCKED legacy cover: ${legacyOut.blockedReason}`);

  // ---- 1b. COMPOSED cover: heroes + composition + style anchor ----
  const heroIds = resolveHeroAssetIds(book.coverHeroAssetIds, book.pages);
  const heroImages: IllustrationImageInput[] = [];
  for (const id of heroIds) {
    const p = book.pages.find((pg) => pg.assetId === id);
    const url = p?.asset?.url || p?.asset?.thumbnailUrl;
    if (url)
      heroImages.push(
        await fetchImageInput(optimizeCloudinaryUrlForVision(convertHeicToJpeg(url))),
      );
  }
  const qcRows = await prisma.illustrationQcResult.findMany({
    where: { bookId, target: 'page' },
    select: { pageId: true, overallScore: true, passed: true, qcRound: true },
  });
  const anchorPage = selectStyleAnchorPage(
    book.pages.map((p) => ({
      pageId: p.id,
      pageNumber: p.pageNumber,
      generatedImageUrl: p.generatedImageUrl,
    })),
    qcRows,
    starredIds,
    identity,
  );
  let interiorRef: IllustrationImageInput | null = null;
  if (anchorPage?.generatedImageUrl) {
    const interior = await fetchImageInput(
      optimizeCloudinaryUrlForVision(anchorPage.generatedImageUrl),
    );
    interiorRef = await resizeForReference(interior.buffer);
    console.log(`  style anchor: page ${anchorPage.pageNumber}`);
  }
  const composedPrompt = createIllustrationPrompt({
    style: styleKey,
    pageText: book.themeLine || book.eventSummary || '',
    bookTitle: book.title,
    isTitlePage: true,
    illustrationNotes: null,
    language: book.language || 'en',
    referenceImageCount: styleRefs.length,
    characterIdentity: identity,
    pageNumber: 0,
    qcFeedback: null,
    characterSheetCount: sheetRefs.length,
    interiorRenderCount: interiorRef ? 1 : 0,
    coverComposition: { themeLine: book.themeLine, heroPhotoCount: heroImages.length },
  } satisfies IllustrationPromptOptions);
  savePrompt('cover-composed', composedPrompt);
  const composedOut = await countedGenerate('cover (composed)', {
    contentImage: heroImages[0],
    characterRefs: [...heroImages.slice(1), ...sheetRefs, ...(interiorRef ? [interiorRef] : [])],
    styleRefs,
    prompt: composedPrompt,
  });
  if (composedOut.imageBase64) savePng('x17-cover-composed', composedOut.imageBase64);
  else console.log(`  BLOCKED composed cover: ${composedOut.blockedReason}`);

  // ---- 2. Ensemble sheets (--ensemble) ----
  if (simulateEnsemble && identity?.characters?.length) {
    const selected = selectSheetCharacters(identity.characters, memberIds);
    console.log(`\n[sheets] ensemble selection: ${selected.map((c) => c.characterId).join(', ')}`);
    const exemplarUrls = STYLE_LIBRARY[styleKey].referenceImageUrls.slice(
      0,
      STYLE_EXEMPLARS_FOR_SHEET,
    );
    const exemplars = await fetchRefs(exemplarUrls);
    for (let i = 0; i < selected.length; i++) {
      const character = selected[i];
      const photoUrls = resolveCharacterPhotoUrls(
        character,
        book.pages.map((p) => ({ assetId: p.assetId, asset: p.asset })),
      );
      if (photoUrls.length === 0) continue;
      const photos = await fetchRefs(photoUrls);
      const prompt = createCharacterSheetPrompt({
        character,
        photoCount: photos.length,
        styleRefCount: exemplars.length,
        styleBible: getStyleBible(styleKey),
        subjectKind: sheetSubjectKind(character.role),
        subjectAnchor: subjectAnchorFor(character),
      });
      const slug = (character.role || 'subject').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      savePrompt(`sheet-${i + 1}-${slug}`, prompt);
      const out = await countedGenerate(`sheet ${character.characterId}`, {
        contentImage: photos[0],
        characterRefs: photos.slice(1),
        styleRefs: exemplars,
        prompt,
      });
      if (out.imageBase64) savePng(`x17-sheet-${i + 1}-${slug}`, out.imageBase64);
      else console.log(`  BLOCKED sheet ${character.characterId}: ${out.blockedReason}`);
    }
  }

  // ---- 3. PDFs simulating the composed/ensemble state (best-effort) ----
  try {
    const { generateBookPdf, generateLuluCover } = await import('@storywink/pdf');
    const { loadWorkerPdfFonts } = await import('../apps/workers/src/utils/pdf-fonts.js');
    const fonts = loadWorkerPdfFonts();
    const simulated = {
      ...book,
      coverAssetId: null,
      ...(simulateEnsemble ? { castMode: 'ensemble', castMemberIds: memberIds } : {}),
    } as typeof book;
    const interiorPdf = await generateBookPdf(simulated, { fonts });
    writeFileSync(path.join(SCREENSHOTS, 'x17-lulu-interior.pdf'), interiorPdf);
    const coverPdf = await generateLuluCover(simulated, { fonts });
    writeFileSync(path.join(SCREENSHOTS, 'x17-lulu-cover.pdf'), coverPdf);
    const exportPdf = await generateBookPdf(simulated, {
      fonts,
      titlePage: simulated.coverImageUrl
        ? ({ pageNumber: 0, generatedImageUrl: simulated.coverImageUrl } as never)
        : undefined,
      includeBackCover: true,
      padToFour: false,
    });
    writeFileSync(path.join(SCREENSHOTS, 'x17-export.pdf'), exportPdf);
    console.log('\n[pdfs] wrote x17-lulu-interior.pdf, x17-lulu-cover.pdf, x17-export.pdf');
  } catch (pdfError) {
    console.log(
      `\n[pdfs] SKIPPED (puppeteer/fonts unavailable here): ${pdfError instanceof Error ? pdfError.message : pdfError}`,
    );
  }

  console.log(`\n[x17-proof] done. Total generate() calls: ${generateCalls}.`);
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
