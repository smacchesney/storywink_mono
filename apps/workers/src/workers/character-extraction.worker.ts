import { Job, FlowProducer } from 'bullmq';
import prisma from '../database/index.js';
import { CharacterExtractionJob, CharacterIdentity, QUEUE_NAMES } from '@storywink/shared';
import { GoogleGenAI } from '@google/genai';
import { createBullMQConnection } from '@storywink/shared/redis';
import pino from 'pino';
import {
  createCharacterExtractionPrompt,
  CHARACTER_IDENTITY_SYSTEM_PROMPT,
  CHARACTER_IDENTITY_RESPONSE_SCHEMA,
  CharacterExtractionInput,
} from '@storywink/shared/prompts/character-identity';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Fetch an image from a URL and return it as base64 with its MIME type.
 */
async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get('content-type');
  const mimeType = contentType?.startsWith('image/') ? contentType.split(';')[0] : 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  return { data: buffer.toString('base64'), mimeType };
}

export async function processCharacterExtraction(job: Job<CharacterExtractionJob>) {
  const { bookId, userId, artStyle } = job.data;

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

    // 2. Get all story pages (exclude title page)
    const storyPages = book.pages.filter(p => !p.isTitlePage);

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

    // 5. Fetch all images as base64
    const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
    for (const page of extractionInput.storyPages) {
      if (page.imageUrl) {
        try {
          const { data, mimeType } = await fetchImageAsBase64(page.imageUrl);
          imageParts.push({ inlineData: { mimeType, data } });
        } catch (err) {
          logger.warn({ bookId, pageNumber: page.pageNumber, error: (err as Error).message }, 'Failed to fetch page image for extraction');
        }
      }
    }

    if (imageParts.length === 0) {
      logger.warn({ bookId }, 'No images available for character extraction');
    } else {
      // 6. Call Gemini vision
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

      const result = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          ...imageParts,
          promptText,
        ],
        config: {
          systemInstruction: CHARACTER_IDENTITY_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: CHARACTER_IDENTITY_RESPONSE_SCHEMA as any,
          maxOutputTokens: 8000,
        },
      });

      const rawResult = result.text;
      if (!rawResult) {
        logger.error({ bookId }, 'Gemini returned empty response for character extraction');
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
  await createIllustrationFlow(bookId, userId, characterIdentity);

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

  // Smart retry: filter pages that need illustration
  const isRetry = book.status === 'PARTIAL' || book.status === 'FAILED';

  let pagesToProcess = book.pages;
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
