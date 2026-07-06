import { Job, FlowProducer } from 'bullmq';
import prisma from '../database/index.js';
import { CharacterExtractionJob, CharacterIdentity, CharacterSheetRef, QUEUE_NAMES } from '@storywink/shared';
import { characterSheetsEnabled, ensureCharacterSheets } from '../lib/character-sheets.js';
import OpenAI from 'openai';
import { createBullMQConnection } from '@storywink/shared/redis';
import pino from 'pino';
import {
  createCharacterExtractionPrompt,
  CHARACTER_IDENTITY_SYSTEM_PROMPT,
  CHARACTER_IDENTITY_RESPONSE_SCHEMA,
  CharacterExtractionInput,
  createStyleTranslationRefreshPrompt,
  STYLE_TRANSLATION_REFRESH_SYSTEM_PROMPT,
  STYLE_TRANSLATION_REFRESH_SCHEMA,
} from '@storywink/shared/prompts/character-identity';
import { optimizeCloudinaryUrlForVision, convertHeicToJpeg, remapCharacterPages } from '@storywink/shared/utils';
import { mergeCastNames, CaptureAnswerLike } from '../lib/resolveCast.js';
import { bridgePagesEnabled } from '../lib/bridge-pages.js';
import { ANALYSIS_MODEL } from '../config/models.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Best-effort write of Book.generationPhase — the honest-progress signal the
 * wait screen narrates from. A phase write must never fail a job.
 */
async function setGenerationPhase(bookId: string, phase: string | null): Promise<void> {
  try {
    await prisma.book.update({ where: { id: bookId }, data: { generationPhase: phase } });
  } catch (error) {
    logger.warn(
      { bookId, phase, error: error instanceof Error ? error.message : 'Unknown error' },
      'Failed to write generationPhase — continuing',
    );
  }
}

export async function processCharacterExtraction(job: Job<CharacterExtractionJob>) {
  const { bookId, userId, artStyle, pageIds } = job.data;

  logger.info({ bookId, userId, artStyle }, 'Starting character identity extraction');

  await setGenerationPhase(bookId, 'characters');

  let characterIdentity: CharacterIdentity | null = null;

  try {
    // 1. Fetch book with pages
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        pages: {
          orderBy: { index: 'asc' },
          include: { asset: true },
        },
      },
    });

    if (!book) throw new Error('Book not found');

    // 2. Get all pages (including cover page)
    const storyPages = book.pages;

    // Re-apply the capture-answer merge (same resolveCast helper the story
    // worker uses) BEFORE the reuse branch and BEFORE character sheets: an
    // in-flight DRAFT perception refresh can overwrite the roster after the
    // story worker persisted its merge, and this closes that race at the
    // exact consumer that feeds names into the illustration prompts.
    let existingIdentity = book.characterIdentity as CharacterIdentity | null;
    if (existingIdentity?.characters?.length) {
      const merge = mergeCastNames({
        characters: existingIdentity.characters,
        captureQuestions: (book.captureQuestions as CaptureAnswerLike[] | null) ?? [],
        childName: book.childName,
      });
      if (merge.changed) {
        existingIdentity = { ...existingIdentity, characters: merge.characters };
        try {
          await prisma.book.update({
            where: { id: bookId },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: { characterIdentity: existingIdentity as any },
          });
          logger.info(
            { bookId, namedCharacters: merge.characters.filter(c => c.name).length },
            'Re-applied capture-answer merge to character identity before reuse',
          );
        } catch (mergeError) {
          logger.warn(
            { bookId, error: mergeError instanceof Error ? mergeError.message : 'Unknown error' },
            'Capture-answer merge persist failed — continuing with in-memory merged identity',
          );
        }
      }
    }

    // Skip the vision call when the perception pass's identity can be
    // remapped onto the CURRENT page order (appearsOnAssetIds stamps present
    // and every referenced asset still on the book). Remapping — not raw
    // reuse — is what makes the skip safe after the parent reorders photos;
    // a swapped/removed photo makes remap return null and we re-extract.
    const remappedIdentity =
      existingIdentity?.characters?.length && storyPages.length > 0
        ? remapCharacterPages(existingIdentity, storyPages.map(p => p.assetId))
        : null;

    if (remappedIdentity) {
      logger.info(
        { bookId, characterCount: remappedIdentity.characters.length },
        'Reusing perception-pass character identity (remapped to current page order) — skipping extraction vision call',
      );
      characterIdentity = remappedIdentity;

      // The styleTranslation prose is style-specific: the perception pass runs
      // at create time when artStyle is still unset (it bakes in 'vignette'),
      // so on nearly every non-vignette book — and after any style switch —
      // the stamp mismatches. Refresh ONLY the translation strings via a cheap
      // text-only call; the remapped identity itself stays valid (never
      // hard-invalidate, which would re-add a vision extraction to the
      // default path).
      if (characterIdentity.extractedForStyle !== artStyle) {
        const refreshed = await refreshStyleTranslations(characterIdentity, artStyle, bookId);
        if (refreshed) {
          characterIdentity = refreshed;
          await prisma.book.update({
            where: { id: bookId },
            data: { characterIdentity: characterIdentity as any },
          });
        }
        // On refresh failure: proceed with the stale translations (graceful
        // degradation) and leave the stamp untouched so the next run retries.
      }

      // Sheets are ensured on BOTH paths — this remap-skip early return is
      // the common path (single-page fixes, retries), and skipping it here
      // would strip sheets from exactly those re-renders.
      const characterSheets = await ensureCharacterSheets({
        bookId,
        userId,
        artStyle,
        identity: characterIdentity,
        pages: storyPages,
        existingReferences: book.characterReferences,
        logger,
      });

      await createIllustrationFlow(bookId, userId, characterIdentity, pageIds, characterSheets);
      return { success: true, characterCount: characterIdentity.characters.length, reused: true };
    }

    // 3. Parse additional characters
    let additionalCharacters: { name: string; relationship: string }[] | null = null;
    if (book.additionalCharacters) {
      try {
        additionalCharacters = JSON.parse(book.additionalCharacters);
      } catch {
        logger.warn({ bookId }, 'Failed to parse additionalCharacters');
      }
    }

    // 4. Build prompt. Positional numbering runs over PHOTO pages only
    // (assetId != null): bridge rows have no photo, and numbering them would
    // desync every appearsOnPages position the model echoes back.
    const photoPages = storyPages.filter(p => p.assetId != null);
    const extractionInput: CharacterExtractionInput = {
      childName: book.childName,
      additionalCharacters,
      artStyle,
      storyPages: photoPages.map((p, i) => ({
        pageNumber: i + 1,
        imageUrl: p.asset?.url || p.asset?.thumbnailUrl || p.originalImageUrl || '',
      })),
    };

    const promptText = createCharacterExtractionPrompt(extractionInput);

    // 5. Build image content parts from URLs directly (no base64 fetching)
    const contentParts: Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_image'; image_url: string; detail: 'high' }
    > = [];

    for (const page of extractionInput.storyPages) {
      if (page.imageUrl) {
        const url = optimizeCloudinaryUrlForVision(convertHeicToJpeg(page.imageUrl));
        contentParts.push({ type: 'input_image', image_url: url, detail: 'high' });
      }
    }

    if (contentParts.length === 0) {
      logger.warn({ bookId }, 'No images available for character extraction');
    } else {
      // Add the text prompt after all images
      contentParts.push({ type: 'input_text', text: promptText.text });

      // 6. Call OpenAI vision
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const result = await openai.responses.create({
        model: ANALYSIS_MODEL,
        instructions: CHARACTER_IDENTITY_SYSTEM_PROMPT,
        input: [{ role: 'user', content: contentParts }],
        text: {
          format: {
            type: 'json_schema',
            name: 'character_identity',
            strict: true,
            schema: CHARACTER_IDENTITY_RESPONSE_SCHEMA as Record<string, unknown>,
          },
        },
      });

      const rawResult = result.output_text;
      if (!rawResult) {
        logger.error({ bookId }, 'OpenAI returned empty response for character extraction');
      } else {
        // Stamp the style the styleTranslation prose was written for — the
        // reuse path refreshes the translations when this stamp mismatches.
        // Also stamp appearsOnAssetIds (same convention as the perception
        // pass, photo-analysis.worker.ts): appearsOnPages is positional over
        // the PHOTO pages sent above, and without the asset stamps this
        // identity could never be remapped after a reorder or bridge insert.
        const parsedIdentity = JSON.parse(rawResult) as CharacterIdentity;
        characterIdentity = {
          ...parsedIdentity,
          extractedForStyle: artStyle,
          characters: (parsedIdentity.characters ?? []).map(c => ({
            ...c,
            appearsOnAssetIds: c.appearsOnPages.map(n => photoPages[n - 1]?.assetId ?? null),
          })),
        };

        // Fresh extractions mint new characterIds, so chip answers rarely
        // join here — but the merge still stamps main_child's name with its
        // childName provenance, and never guesses on failed joins.
        const freshMerge = mergeCastNames({
          characters: characterIdentity!.characters,
          captureQuestions: (book.captureQuestions as CaptureAnswerLike[] | null) ?? [],
          childName: book.childName,
        });
        if (freshMerge.changed) {
          characterIdentity = { ...characterIdentity!, characters: freshMerge.characters };
        }

        // 7. Store on Book record
        await prisma.book.update({
          where: { id: bookId },
          data: { characterIdentity: characterIdentity as any },
        });

        logger.info({
          bookId,
          characterCount: characterIdentity!.characters.length,
        }, 'Character identity extraction completed');
      }
    }
  } catch (error) {
    // Log but don't throw — we proceed with null characterIdentity (graceful degradation)
    logger.error({
      bookId,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 'Character identity extraction failed — proceeding without character identity');
  }

  // 8. Ensure character sheets (fresh-extraction path; the remap path above
  // has its own call). The book is re-fetched because the extraction `book`
  // is scoped to the try block; ensureCharacterSheets itself never throws.
  let characterSheets: CharacterSheetRef[] = [];
  try {
    const bookForSheets = characterSheetsEnabled()
      ? await prisma.book.findUnique({
          where: { id: bookId },
          select: {
            characterReferences: true,
            pages: {
              orderBy: { index: 'asc' },
              select: {
                assetId: true,
                asset: { select: { url: true, thumbnailUrl: true } },
              },
            },
          },
        })
      : null;
    if (bookForSheets) {
      characterSheets = await ensureCharacterSheets({
        bookId,
        userId,
        artStyle,
        identity: characterIdentity,
        pages: bookForSheets.pages,
        existingReferences: bookForSheets.characterReferences,
        logger,
      });
    }
  } catch (sheetError) {
    logger.warn(
      { bookId, error: sheetError instanceof Error ? sheetError.message : 'Unknown error' },
      'Character sheet step failed — proceeding without sheets',
    );
  }

  // 9. Create the illustration FlowProducer flow
  // This runs regardless of whether extraction succeeded (graceful degradation)
  await createIllustrationFlow(bookId, userId, characterIdentity, pageIds, characterSheets);

  return { success: true, characterCount: characterIdentity?.characters?.length ?? 0 };
}

/**
 * Rewrites ONLY the styleTranslation strings of an identity for a new art
 * style via a text-only gpt-5-mini call (no images — this must stay cheap
 * enough for the default path of every non-vignette book). Returns the
 * refreshed identity stamped with the new style, or null on any failure so
 * the caller degrades to the stale translations.
 */
async function refreshStyleTranslations(
  identity: CharacterIdentity,
  artStyle: string,
  bookId: string,
): Promise<CharacterIdentity | null> {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn({ bookId }, 'Skipping styleTranslation refresh: OPENAI_API_KEY not configured');
    return null;
  }

  try {
    const promptText = createStyleTranslationRefreshPrompt(
      identity.characters.map(c => ({
        characterId: c.characterId,
        role: c.role,
        name: c.name,
        physicalTraits: c.physicalTraits,
        typicalClothing: c.typicalClothing,
      })),
      artStyle,
    );

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await openai.responses.create({
      model: ANALYSIS_MODEL,
      instructions: STYLE_TRANSLATION_REFRESH_SYSTEM_PROMPT,
      input: [{ role: 'user', content: [{ type: 'input_text', text: promptText }] }],
      text: {
        format: {
          type: 'json_schema',
          name: 'style_translation_refresh',
          strict: true,
          schema: STYLE_TRANSLATION_REFRESH_SCHEMA as Record<string, unknown>,
        },
      },
    });

    const rawResult = result.output_text;
    if (!rawResult) {
      logger.warn({ bookId, artStyle }, 'styleTranslation refresh returned empty response');
      return null;
    }

    const parsed = JSON.parse(rawResult) as {
      translations: Array<{ characterId: string; styleTranslation: string }>;
    };
    const translationById = new Map(
      parsed.translations.map(t => [t.characterId, t.styleTranslation]),
    );

    logger.info(
      { bookId, artStyle, refreshedCount: translationById.size, characterCount: identity.characters.length },
      'Refreshed styleTranslation strings for new art style',
    );

    return {
      ...identity,
      extractedForStyle: artStyle,
      characters: identity.characters.map(c => ({
        ...c,
        styleTranslation: translationById.get(c.characterId) ?? c.styleTranslation,
      })),
    };
  } catch (error) {
    logger.warn(
      { bookId, artStyle, error: error instanceof Error ? error.message : 'Unknown error' },
      'styleTranslation refresh failed — proceeding with existing translations',
    );
    return null;
  }
}

/**
 * Creates the FlowProducer illustration flow (parent finalize + children illustration jobs).
 * This logic is moved from the API endpoints into the worker for sequential execution
 * after character extraction.
 */
async function createIllustrationFlow(
  bookId: string,
  userId: string,
  characterIdentity: CharacterIdentity | null,
  pageIds?: string[],
  characterSheets?: CharacterSheetRef[],
): Promise<void> {
  // Re-fetch book to get latest page data
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: {
      pages: {
        orderBy: { index: 'asc' },
        select: {
          id: true,
          text: true,
          originalImageUrl: true,
          illustrationNotes: true,
          assetId: true,
          index: true,
          pageNumber: true,
          isTitlePage: true,
          moderationStatus: true,
          generatedImageUrl: true,
          source: true,
        },
      },
    },
  });

  if (!book) throw new Error('Book not found when creating illustration flow');

  // Determine which pages to process
  let pagesToProcess = book.pages;

  if (pageIds && pageIds.length > 0) {
    // Explicit page IDs provided — only illustrate those specific pages
    const requestedIds = new Set(pageIds);
    pagesToProcess = book.pages.filter((page) => requestedIds.has(page.id));

    logger.info({
      bookId,
      requestedPageIds: pageIds,
      matchedPages: pagesToProcess.length,
    }, 'Filtering to explicitly requested pageIds');
  } else {
    // No specific pages requested — use existing smart retry / first-run logic
    const isRetry = book.status === 'PARTIAL' || book.status === 'FAILED';

    // BRIDGE_PAGES_ENABLED off: bridge rows (left behind by a flag rollback)
    // must not enqueue from the implicit paths. Explicit pageIds requests
    // above are still honored — a parent's direct "try drawing again" on an
    // existing bridge row renders fine via the worker's DB-driven branch, and
    // silently dropping it would strand the book in ILLUSTRATING.
    const includeBridges = bridgePagesEnabled();

    if (isRetry) {
      pagesToProcess = book.pages.filter((page) => {
        if (page.source === 'BRIDGE' && !includeBridges) return false;
        if (page.moderationStatus === 'OK' && page.generatedImageUrl) return false;
        if (page.moderationStatus === 'FLAGGED') return false;
        return true;
      });

      logger.info({
        bookId,
        totalPages: book.pages.length,
        pagesToRetry: pagesToProcess.length,
        skippedOk: book.pages.filter(p => p.moderationStatus === 'OK' && p.generatedImageUrl).length,
        skippedFlagged: book.pages.filter(p => p.moderationStatus === 'FLAGGED').length,
      }, 'Smart retry - filtering to failed/missing pages only');
    } else {
      // For first-time illustration, filter to pages that have text ready
      pagesToProcess = book.pages.filter((p) => {
        if (p.source === 'BRIDGE' && !includeBridges) return false;
        const hasText = !!(p.text && p.text.trim());
        return hasText;
      });
    }
  }

  if (pagesToProcess.length === 0) {
    logger.warn({ bookId }, 'No pages to illustrate after filtering');
    return;
  }

  // Create child job definitions
  const pageChildren = pagesToProcess.map((page) => ({
    name: `generate-illustration-${bookId}-p${page.pageNumber}`,
    queueName: QUEUE_NAMES.ILLUSTRATION_GENERATION,
    data: {
      userId,
      bookId,
      pageId: page.id,
      pageNumber: page.pageNumber,
      text: page.text,
      artStyle: book.artStyle,
      bookTitle: book.title,
      isTitlePage: page.isTitlePage,
      illustrationNotes: page.illustrationNotes,
      originalImageUrl: page.originalImageUrl,
      characterIdentity,
      // Snapshot sheet refs like characterIdentity — the illustration worker
      // must not depend on Book row state at render time.
      ...(characterSheets?.length ? { characterSheets } : {}),
      language: book.language,
    },
    opts: {
      attempts: 5,
      backoff: { type: 'exponential' as const, delay: 10000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
      failParentOnFailure: false,
      removeDependencyOnFailure: true,
    },
  }));

  // Create FlowProducer and add the flow
  const flowProducer = new FlowProducer({ connection: createBullMQConnection() });

  try {
    const flow = await flowProducer.add({
      name: `finalize-book-${bookId}`,
      queueName: QUEUE_NAMES.BOOK_FINALIZE,
      // scopedPageIds tells finalize this run was a targeted re-render (e.g.
      // single-page reillustrate) — QC must not cascade regenerations onto
      // pages the user never asked to touch.
      data: { bookId, userId, ...(pageIds?.length ? { scopedPageIds: pageIds } : {}) },
      opts: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
      children: pageChildren,
    });

    logger.info({
      bookId,
      childJobCount: pageChildren.length,
      flowJobId: flow.job.id,
      hasCharacterIdentity: !!characterIdentity,
      characterSheetCount: characterSheets?.length ?? 0,
    }, 'Created illustration flow from character extraction worker');

    // Renders are now in flight — the wait screen can start counting pages.
    await setGenerationPhase(bookId, 'illustrating');
  } finally {
    await flowProducer.close();
  }
}
