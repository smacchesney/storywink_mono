import { Job } from 'bullmq';
import prisma from '../database/index.js';
import { StoryGenerationJob } from '@storywink/shared/types';
import OpenAI from 'openai';
import pino from 'pino';
import {
  createStoryGenerationPrompt,
  StoryGenerationInput,
  STORY_GENERATION_SYSTEM_PROMPT,
  StoryResponse,
  STORY_RESPONSE_SCHEMA,
} from '@storywink/shared/prompts/story';
import { optimizeCloudinaryUrlForVision, convertHeicToJpeg } from '@storywink/shared/utils';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export async function processStoryGeneration(job: Job<StoryGenerationJob & { singlePageId?: string }>) {
  // Wrap everything in try-catch to catch early errors
  try {
    // Early validation
    if (!job) {
      throw new Error('Job is undefined');
    }

    if (!job.data) {
      throw new Error('Job data is undefined');
    }

    // Validate OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Safe access to job data
    const bookId = job.data.bookId;
    const userId = job.data.userId;
    const singlePageId = job.data.singlePageId;

    // Route to single-page handler if singlePageId is present
    if (singlePageId) {
      return await processSinglePageTextGeneration(job, openai, bookId, singlePageId);
    }

    if (!bookId || !userId) {
      throw new Error(`Missing required job data: bookId=${bookId}, userId=${userId}`);
    }

    // Update status to generating
    await prisma.book.update({
      where: { id: bookId },
      data: { status: 'GENERATING' },
    });

    // Get book with pages (excluding cover page)
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        pages: {
          orderBy: { index: 'asc' }, // Use user-defined order, not pageNumber
          include: { asset: true },
        },
      },
    });

    if (!book) {
      throw new Error('Book not found');
    }

    // Filter out cover/title page to get story pages with their assets
    // Use isTitlePage field which is always set correctly, instead of coverAssetId which may be null
    const storyPages = book.pages.filter(page => !page.isTitlePage);

    if (!storyPages || storyPages.length === 0) {
      throw new Error('Book has no story pages (excluding cover)');
    }

    // Diagnostic logging for debugging text assignment issues
    logger.info({
      bookId,
      totalPages: book.pages.length,
      coverAssetId: book.coverAssetId,
      storyPagesCount: storyPages.length,
      expectedPageLength: book.pageLength,
      actualPageLength: book.pages.length,
      storyPageDetails: storyPages.map(p => ({
        id: p.id,
        index: p.index,
        pageNumber: p.pageNumber,
        assetId: p.assetId,
        hasExistingText: !!p.text
      }))
    }, 'Story generation page analysis');

    // Validate page count
    if (storyPages.length !== book.pageLength - 1) {
      logger.warn({
        bookId,
        storyPagesCount: storyPages.length,
        expectedStoryPages: book.pageLength - 1,
        bookPageLength: book.pageLength,
        totalPagesInBook: book.pages.length
      }, 'Page count mismatch - story pages vs expected');
    }

    // Parse additional characters from JSON string (if present)
    let additionalCharacters: { name: string; relationship: string }[] = [];
    if (book.additionalCharacters) {
      try {
        additionalCharacters = JSON.parse(book.additionalCharacters);
      } catch (e) {
        logger.warn({ bookId, error: e }, 'Failed to parse additionalCharacters');
      }
    }

    // Prepare story generation input using advanced prompt structure
    const storyInput: StoryGenerationInput = {
      bookTitle: book.title || 'My Special Story',
      isDoubleSpread: false, // Could be added to book settings in future
      artStyle: book.artStyle || undefined,
      childName: book.childName || undefined,
      additionalCharacters: additionalCharacters.length > 0 ? additionalCharacters : undefined,
      language: book.language || 'en',
      storyPages: storyPages.map((page, index) => ({
        pageId: page.id,
        pageNumber: index + 1, // 1-based numbering for story pages
        assetId: page.assetId,
        originalImageUrl: page.asset?.url || page.asset?.thumbnailUrl || null
      })),
    };

    // Create the prompt parts and map to OpenAI content parts
    const promptParts = createStoryGenerationPrompt(storyInput);
    const contentParts: Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_image'; image_url: string; detail: 'high' }
    > = [];

    for (const part of promptParts) {
      if ('type' in part && part.type === 'image_placeholder') {
        const url = optimizeCloudinaryUrlForVision(convertHeicToJpeg(part.imageUrl));
        contentParts.push({ type: 'input_image', image_url: url, detail: 'high' });
      } else if ('text' in part) {
        contentParts.push({ type: 'input_text', text: part.text });
      }
    }

    // Call OpenAI with vision for story generation
    const result = await openai.responses.create({
      model: 'gpt-5-mini',
      instructions: STORY_GENERATION_SYSTEM_PROMPT,
      input: [{ role: 'user', content: contentParts }],
      text: {
        format: {
          type: 'json_schema',
          name: 'story_response',
          strict: true,
          schema: STORY_RESPONSE_SCHEMA as Record<string, unknown>,
        },
      },
    });

    const rawResult = result.output_text;
    if (!rawResult) {
      throw new Error('OpenAI returned empty response');
    }

    // Log raw response for debugging
    logger.info({ bookId, rawResponse: rawResult.substring(0, 500) }, 'Raw OpenAI response received');

    // Defensive: strip markdown code block wrapping if present
    let cleanedResult = rawResult.trim();
    if (cleanedResult.startsWith('```')) {
      cleanedResult = cleanedResult.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    // Parse the response and prepare update data (not promises yet)
    interface PageUpdateData {
      pageId: string;
      text: string;
      illustrationNotes: string | null;
      textConfirmed: boolean;
    }
    let pageUpdates: PageUpdateData[] = [];

    try {
      // Response format: { pages: [{ pageNumber, text, illustrationNotes }, ...] }
      const storyResponse: StoryResponse = JSON.parse(cleanedResult);

      logger.info({ bookId, pageCount: storyResponse.pages?.length }, 'Parsing story response');

      // Validate that all expected pages are present in response
      const expectedPageNumbers = storyPages.map((_, i) => i + 1);
      const receivedPageNumbers = storyResponse.pages?.map(p => p.pageNumber) || [];
      const missingPages = expectedPageNumbers.filter(p => !receivedPageNumbers.includes(p));

      if (missingPages.length > 0) {
        logger.warn({
          bookId,
          missingPages,
          expectedCount: expectedPageNumbers.length,
          receivedCount: receivedPageNumbers.length
        }, 'Some pages missing from OpenAI response');
      }

      // Prepare update data for all story pages
      pageUpdates = storyPages.map((page, index) => {
        const storyPosition = index + 1; // 1-based position
        const content = storyResponse.pages?.find(p => p.pageNumber === storyPosition);

        if (!content) {
          logger.warn({
            bookId,
            pageId: page.id,
            storyPosition,
            pageNumber: page.pageNumber
          }, 'No content generated for this page - using defaults');
        }

        // Fix for empty string bug: check if text exists AND is not empty after trim
        const trimmedText = content?.text?.trim() || '';
        const finalText = trimmedText.length > 0 ? trimmedText : `[Page ${storyPosition} text pending]`;

        // Normalize empty string illustrationNotes to null
        const notes = content?.illustrationNotes?.trim() || null;

        logger.info({
          bookId,
          pageId: page.id,
          pageNumber: page.pageNumber,
          index: page.index,
          storyPosition,
          finalTextLength: finalText.length,
          hadContent: !!content,
          usedFallback: !content || trimmedText.length === 0,
          textPreview: finalText.substring(0, 50),
          hasIllustrationNotes: !!notes
        }, 'Prepared page update');

        return {
          pageId: page.id,
          text: finalText,
          illustrationNotes: notes,
          textConfirmed: trimmedText.length > 0,
        };
      });
    } catch (parseError) {
      logger.error({
        bookId,
        parseError: parseError instanceof Error ? parseError.message : 'Unknown parse error',
        rawResponseLength: rawResult.length,
        rawResponseFirst500: rawResult.substring(0, 500),
        rawResponseLast200: rawResult.substring(rawResult.length - 200),
        cleanedResultFirst500: cleanedResult.substring(0, 500),
      }, 'Failed to parse OpenAI response');
      throw new Error(`Invalid JSON response from OpenAI: ${parseError instanceof Error ? parseError.message : 'unknown error'}`);
    }

    logger.info({
      bookId,
      totalPageUpdates: pageUpdates.length,
      expectedStoryPages: storyPages.length,
      matches: pageUpdates.length === storyPages.length
    }, 'Executing batch page updates via transaction');

    try {
      // Use $transaction with a callback to execute updates sequentially
      // This avoids SIGSEGV crashes from too many parallel Prisma queries
      const results = await prisma.$transaction(async (tx) => {
        const updateResults = [];
        for (const update of pageUpdates) {
          const result = await tx.page.update({
            where: { id: update.pageId },
            data: {
              text: update.text,
              illustrationNotes: update.illustrationNotes,
              textConfirmed: update.textConfirmed,
            },
          });
          updateResults.push(result);
        }
        return updateResults;
      });
      logger.info({
        bookId,
        successfulUpdates: results.length,
        totalExpected: storyPages.length
      }, 'Batch update completed');
    } catch (error) {
      logger.error({
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
        updateCount: pageUpdates.length
      }, 'Batch update failed');
      throw error;
    }

    // Verify all story pages actually received text in the database
    const pagesAfterUpdate = await prisma.page.findMany({
      where: {
        bookId,
        isTitlePage: false
      },
      select: {
        id: true,
        pageNumber: true,
        index: true,
        text: true
      },
      orderBy: { index: 'asc' }
    });

    const pagesWithoutText = pagesAfterUpdate.filter(p => !p.text || p.text.trim().length === 0);

    if (pagesWithoutText.length > 0) {
      logger.error({
        bookId,
        totalStoryPages: pagesAfterUpdate.length,
        pagesWithoutText: pagesWithoutText.length,
        missingPageNumbers: pagesWithoutText.map(p => p.pageNumber),
        missingPageIndices: pagesWithoutText.map(p => p.index),
        pageUpdatesCreated: pageUpdates.length,
        expectedStoryPages: storyPages.length,
      }, 'CRITICAL: Some pages missing text after batch update - applying fallback');

      // Fix pages that didn't get text
      const fixPromises = pagesWithoutText.map((page) => {
        const fallbackText = `[Page ${page.pageNumber} text pending - please regenerate]`;
        logger.warn({
          bookId,
          pageId: page.id,
          pageNumber: page.pageNumber,
          fallbackText
        }, 'Applying fallback text to page that was missed');

        return prisma.page.update({
          where: { id: page.id },
          data: {
            text: fallbackText,
            textConfirmed: false
          }
        });
      });

      await Promise.all(fixPromises);
      logger.info({
        bookId,
        fixedPages: fixPromises.length
      }, 'Applied fallback text to pages that were missed');
    } else {
      logger.info({
        bookId,
        totalStoryPages: pagesAfterUpdate.length,
        allPagesHaveText: true
      }, 'Verification passed: All story pages have text');
    }

    // Update book status to story ready (not yet illustrating)
    await prisma.book.update({
      where: { id: bookId },
      data: {
        status: 'STORY_READY',
        updatedAt: new Date(),
      },
    });

    logger.info({
      bookId,
      pagesUpdated: pageUpdates.length,
      totalStoryPages: storyPages.length,
      allPagesHaveText: pageUpdates.length === storyPages.length
    }, 'Story generation completed');
    return { success: true, pagesUpdated: pageUpdates.length };

  } catch (error: any) {
    logger.error({
      error: error.message,
      bookId: job?.data?.bookId
    }, 'Story generation failed');

    // Update book status to failed if we have a bookId
    if (job?.data?.bookId) {
      await prisma.book.update({
        where: { id: job.data.bookId },
        data: { status: 'FAILED' },
      }).catch(() => {}); // Ignore errors when updating status
    }

    throw error;
  }
}

/**
 * Generate text for a single page using surrounding narrative context.
 * Used when a user replaces a flagged photo on a PARTIAL book.
 * Does NOT change book status — the book stays PARTIAL.
 */
async function processSinglePageTextGeneration(
  job: Job,
  openai: OpenAI,
  bookId: string,
  pageId: string,
) {
  logger.info({ bookId, pageId, jobId: job.id }, 'Starting single-page text generation');

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

  const targetPage = book.pages.find(p => p.id === pageId);
  if (!targetPage) throw new Error('Target page not found');

  const photoUrl = targetPage.asset?.url || targetPage.asset?.thumbnailUrl || targetPage.originalImageUrl;
  if (!photoUrl) throw new Error('Target page has no photo');

  // Get story pages (excluding title page) for context
  const storyPages = book.pages.filter(p => !p.isTitlePage);
  const targetIndex = storyPages.findIndex(p => p.id === pageId);

  const prevPages = storyPages.slice(Math.max(0, targetIndex - 2), targetIndex);
  const nextPages = storyPages.slice(targetIndex + 1, targetIndex + 3);

  const prevContext = prevPages.filter(p => p.text).map(p => `Page ${p.pageNumber}: "${p.text}"`).join('\n');
  const nextContext = nextPages.filter(p => p.text).map(p => `Page ${p.pageNumber}: "${p.text}"`).join('\n');

  // Parse additional characters
  let characterInfo = '';
  if (book.childName) {
    characterInfo = `The main character is named "${book.childName}".`;
    if (book.additionalCharacters) {
      try {
        const chars = JSON.parse(book.additionalCharacters) as Array<{ name: string; relationship: string }>;
        if (chars.length > 0) {
          characterInfo += ` Other characters: ${chars.map(c => `"${c.name}" (${c.relationship})`).join(', ')}.`;
        }
      } catch { /* ignore parse errors */ }
    }
  }

  const language = book.language || 'en';
  const languageInstruction = language === 'ja'
    ? 'Write the story text in Japanese (hiragana preferred for young children). Use simple, warm language.'
    : 'Write the story text in English.';

  const promptText = [
    `You are writing page ${targetPage.pageNumber} of a children's picture book titled "${book.title || 'My Special Story'}".`,
    characterInfo,
    languageInstruction,
    '',
    prevContext ? `## Story so far (previous pages):\n${prevContext}` : '## This is near the beginning of the story.',
    '',
    `## Your task:`,
    `Write story text for page ${targetPage.pageNumber} based on the photo provided. Write 2-4 sentences (max 50 words). The text should feel warm, playful, and natural when read aloud to a toddler.`,
    '',
    nextContext ? `## What comes after (for continuity):\n${nextContext}` : '## This is near the end of the story.',
    '',
    `Also provide brief illustrationNotes describing any visual effects or mood for the illustrator, or null if the photo speaks for itself.`,
  ].join('\n');

  const imageUrl = optimizeCloudinaryUrlForVision(convertHeicToJpeg(photoUrl));

  const SINGLE_PAGE_SCHEMA = {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Story text (2-4 sentences, max 50 words)' },
      illustrationNotes: { type: ['string', 'null'], description: 'Visual notes for illustrator, or null' },
    },
    required: ['text', 'illustrationNotes'],
    additionalProperties: false,
  } as const;

  const result = await openai.responses.create({
    model: 'gpt-5-mini',
    instructions: STORY_GENERATION_SYSTEM_PROMPT,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: imageUrl, detail: 'high' as const },
          { type: 'input_text', text: promptText },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'single_page_story',
        strict: true,
        schema: SINGLE_PAGE_SCHEMA as Record<string, unknown>,
      },
    },
  });

  const responseText = result.output_text;
  if (!responseText) throw new Error('OpenAI returned empty response for single page');

  const parsed = JSON.parse(responseText) as { text: string; illustrationNotes: string | null };

  await prisma.page.update({
    where: { id: pageId },
    data: {
      text: parsed.text,
      illustrationNotes: parsed.illustrationNotes,
      textConfirmed: false,
    },
  });

  logger.info({ bookId, pageId, textLength: parsed.text.length }, 'Single-page text generation completed');
  return { success: true, pageId, text: parsed.text };
}
