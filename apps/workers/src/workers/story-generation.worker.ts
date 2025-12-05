import { Job } from 'bullmq';
import prisma from '../database/index.js';
import { StoryGenerationJob } from '@storywink/shared/types';
import OpenAI from 'openai';
import pino from 'pino';
import {
  createVisionStoryGenerationPrompt,
  StoryGenerationInput,
  STORY_GENERATION_SYSTEM_PROMPT,
  StoryResponse,
  STORY_RESPONSE_SCHEMA
} from '@storywink/shared/prompts/story';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export async function processStoryGeneration(job: Job<StoryGenerationJob>) {
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
    
    // Initialize OpenAI inside the function
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // Safe access to job data
    const bookId = job.data.bookId;
    const userId = job.data.userId;
    
    if (!bookId || !userId) {
      throw new Error(`Missing required job data: bookId=${bookId}, userId=${userId}`);
    }
    
    // Only log for debugging - can remove this line for even less verbosity
    // logger.info({ bookId, userId }, 'Processing story generation');
    
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

    // Prepare story generation input using advanced prompt structure
    const storyInput: StoryGenerationInput = {
      childName: book.childName || 'the child',
      bookTitle: book.title || 'My Special Story',
      isDoubleSpread: false, // Could be added to book settings in future
      artStyle: book.artStyle || undefined,
      storyPages: storyPages.map((page, index) => ({
        pageId: page.id,
        pageNumber: index + 1, // 1-based numbering for story pages
        assetId: page.assetId,
        originalImageUrl: page.asset?.url || page.asset?.thumbnailUrl || null
      }))
    };

    // Create the advanced prompt
    const messageContent = createVisionStoryGenerationPrompt(storyInput);
    
    // Prepare input for OpenAI Responses API (GPT-5.1)
    const input = [
      {
        role: 'system' as const,
        content: STORY_GENERATION_SYSTEM_PROMPT
      },
      {
        role: 'user' as const,
        content: messageContent
      }
    ];

    // Call OpenAI Responses API with GPT-5.1
    const response = await openai.responses.create({
      model: 'gpt-5.1',
      input: input,
      max_output_tokens: 4000, // Increased safety margin for 8+ page books
      text: {
        format: {
          type: 'json_schema',
          name: 'story_response',
          strict: true,
          schema: STORY_RESPONSE_SCHEMA
        }
      }
    });

    const rawResult = response.output_text;
    if (!rawResult) {
      throw new Error('OpenAI returned empty response');
    }

    // Log raw response for debugging
    logger.info({ bookId, rawResponse: rawResult }, 'Raw OpenAI response received');

    // Parse the response and prepare update data (not promises yet)
    interface PageUpdateData {
      pageId: string;
      text: string;
      illustrationNotes: string | null;
      textConfirmed: boolean;
    }
    let pageUpdates: PageUpdateData[] = [];

    try {
      // Response format: { "1": { "text": "...", "illustrationNotes": "..." }, ... }
      const storyResponse: StoryResponse = JSON.parse(rawResult);

      logger.info({ bookId, responseKeys: Object.keys(storyResponse) }, 'Parsing story response');

      // Validate that all expected pages are present in response
      const expectedPageNumbers = storyPages.map((_, i) => (i + 1).toString());
      const receivedPageNumbers = Object.keys(storyResponse);
      const missingPages = expectedPageNumbers.filter(p => !receivedPageNumbers.includes(p));

      if (missingPages.length > 0) {
        logger.warn({
          bookId,
          missingPages,
          expectedCount: expectedPageNumbers.length,
          receivedCount: receivedPageNumbers.length
        }, 'Some pages missing from GPT response');
      }

      // Create a map for easier lookup
      const responseMap = new Map(Object.entries(storyResponse));

      // Prepare update data for all story pages
      pageUpdates = storyPages.map((page, index) => {
        const storyPosition = index + 1; // 1-based position
        const content = responseMap.get(storyPosition.toString());

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
          hasIllustrationNotes: !!content?.illustrationNotes
        }, 'Prepared page update');

        return {
          pageId: page.id,
          text: finalText,
          illustrationNotes: content?.illustrationNotes || null,
          textConfirmed: trimmedText.length > 0,
        };
      });
    } catch (error) {
      logger.error({ bookId, rawResult }, 'Failed to parse OpenAI response');
      throw new Error('Invalid JSON response from OpenAI');
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
        gptResponseKeys: Object.keys(JSON.parse(rawResult))
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