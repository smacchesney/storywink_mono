import { Job, FlowProducer } from 'bullmq';
import prisma from '../database/index.js';
import { CharacterExtractionJob, CharacterIdentity, QUEUE_NAMES } from '@storywink/shared';
import OpenAI from 'openai';
import { createBullMQConnection } from '@storywink/shared/redis';
import pino from 'pino';
import {
  createCharacterExtractionPrompt,
  CHARACTER_IDENTITY_SYSTEM_PROMPT,
  CHARACTER_IDENTITY_RESPONSE_SCHEMA,
  CharacterExtractionInput,
} from '@storywink/shared/prompts/character-identity';
import { optimizeCloudinaryUrlForVision, convertHeicToJpeg } from '@storywink/shared/utils';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export async function processCharacterExtraction(job: Job<CharacterExtractionJob>) {
  const { bookId, userId, artStyle, pageIds } = job.data;

  logger.info({ bookId, userId, artStyle }, 'Starting character identity extraction');

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

    // 3. Parse additional characters
    let additionalCharacters: { name: string; relationship: string }[] | null = null;
    if (book.additionalCharacters) {
      try {
        additionalCharacters = JSON.parse(book.additionalCharacters);
      } catch {
        logger.warn({ bookId }, 'Failed to parse additionalCharacters');
      }
    }

    // 4. Build prompt
    const extractionInput: CharacterExtractionInput = {
      childName: book.childName,
      additionalCharacters,
      artStyle,
      storyPages: storyPages.map((p, i) => ({
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
        model: 'gpt-5-mini',
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
        characterIdentity = JSON.parse(rawResult);

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

  // 8. Create the illustration FlowProducer flow
  // This runs regardless of whether extraction succeeded (graceful degradation)
  await createIllustrationFlow(bookId, userId, characterIdentity, pageIds);

  return { success: true, characterCount: characterIdentity?.characters?.length ?? 0 };
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

    if (isRetry) {
      pagesToProcess = book.pages.filter((page) => {
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
      // For first-time illustration, filter to pages that need processing
      pagesToProcess = book.pages.filter((p) => {
        const isTitle = p.isTitlePage;
        const hasText = !!(p.text && p.text.trim());
        return isTitle || hasText;
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
      data: { bookId, userId },
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
    }, 'Created illustration flow from character extraction worker');
  } finally {
    await flowProducer.close();
  }
}
