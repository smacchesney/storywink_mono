import { Job } from 'bullmq';
import prisma from '../database/index.js';
import { StoryGenerationJob } from '@storywink/shared/types';
import OpenAI from 'openai';
import pino from 'pino';
import {
  createVisionStoryGenerationPrompt,
  StoryGenerationInput,
  STORY_GENERATION_SYSTEM_PROMPT,
  WinkifyStoryResponse,
  StandardStoryResponse
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
      })),
      isWinkifyEnabled: book.isWinkifyEnabled || false
    };

    // Create the advanced prompt
    const messageContent = createVisionStoryGenerationPrompt(storyInput);
    
    // Prepare messages for OpenAI
    const messages = [
      {
        role: 'system',
        content: STORY_GENERATION_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: messageContent
      }
    ];

    // Call OpenAI API with vision
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', // gpt-4o supports vision
      messages: messages as any,
      max_tokens: 4000, // Increased safety margin for 8+ page books with Winkify
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const rawResult = completion.choices[0]?.message?.content;
    if (!rawResult) {
      throw new Error('OpenAI returned empty response');
    }

    // Log raw response for debugging
    logger.info({ bookId, rawResponse: rawResult }, 'Raw OpenAI response received');

    // Parse the response based on Winkify mode
    let updatePromises: any[] = [];

    try {
      if (book.isWinkifyEnabled) {
        // Winkify response format: { "1": { "text": "...", "illustrationNotes": "..." }, ... }
        const winkifyResponse: WinkifyStoryResponse = JSON.parse(rawResult);

        logger.info({ bookId, isWinkifyEnabled: true, responseKeys: Object.keys(winkifyResponse) }, 'Parsing Winkify response');

        // Validate that all expected pages are present in response
        const expectedPageNumbers = storyPages.map((_, i) => (i + 1).toString());
        const receivedPageNumbers = Object.keys(winkifyResponse);
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
        const responseMap = new Map(Object.entries(winkifyResponse));

        // Ensure all story pages get updated, even if AI didn't generate content for some
        updatePromises = storyPages.map((page, index) => {
          const storyPosition = index + 1; // 1-based position
          const content = responseMap.get(storyPosition.toString());

          if (!content) {
            logger.warn({
              bookId,
              pageId: page.id,
              storyPosition,
              pageNumber: page.pageNumber
            }, 'No Winkify content generated for this page - using defaults');
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
          }, 'Winkify: Prepared page update');

          return prisma.page.update({
            where: { id: page.id },
            data: {
              text: finalText,
              illustrationNotes: content?.illustrationNotes || null,
              textConfirmed: trimmedText.length > 0,
            },
          });
        });
        
      } else {
        // Standard response format: { "1": "text...", "2": "text...", ... }
        const standardResponse: StandardStoryResponse = JSON.parse(rawResult);

        logger.info({ bookId, isWinkifyEnabled: false, responseKeys: Object.keys(standardResponse) }, 'Parsing standard response');

        // Validate that all expected pages are present in response
        const expectedPageNumbers = storyPages.map((_, i) => (i + 1).toString());
        const receivedPageNumbers = Object.keys(standardResponse);
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
        const responseMap = new Map(Object.entries(standardResponse));

        // Ensure all story pages get updated, even if AI didn't generate text for some
        updatePromises = storyPages.map((page, index) => {
          const storyPosition = index + 1; // 1-based position
          const text = responseMap.get(storyPosition.toString()) || '';

          if (!text) {
            logger.warn({
              bookId,
              pageId: page.id,
              storyPosition,
              pageNumber: page.pageNumber
            }, 'No text generated for this page - using fallback');
          }

          // Fix for empty string bug: check if text exists AND is not empty after trim
          const trimmedText = text.trim();
          const finalText = trimmedText.length > 0 ? trimmedText : `[Page ${storyPosition} text pending]`;

          logger.info({
            bookId,
            pageId: page.id,
            pageNumber: page.pageNumber,
            index: page.index,
            storyPosition,
            finalTextLength: finalText.length,
            hadContent: !!text,
            usedFallback: trimmedText.length === 0,
            textPreview: finalText.substring(0, 50)
          }, 'Standard: Prepared page update');

          return prisma.page.update({
            where: { id: page.id },
            data: {
              text: finalText,
              textConfirmed: trimmedText.length > 0,
            },
          });
        });
      }
    } catch (error) {
      logger.error({ bookId, rawResult, isWinkifyEnabled: book.isWinkifyEnabled }, 'Failed to parse OpenAI response');
      throw new Error('Invalid JSON response from OpenAI');
    }

    logger.info({
      bookId,
      totalUpdatePromises: updatePromises.length,
      expectedStoryPages: storyPages.length,
      matches: updatePromises.length === storyPages.length
    }, 'Executing batch page updates');

    try {
      const results = await Promise.all(updatePromises);
      logger.info({
        bookId,
        successfulUpdates: results.length,
        totalExpected: storyPages.length
      }, 'Batch update completed');
    } catch (error) {
      logger.error({
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
        updateCount: updatePromises.length
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
        updatePromisesCreated: updatePromises.length,
        expectedStoryPages: storyPages.length,
        gptResponseKeys: book.isWinkifyEnabled ?
          Object.keys(JSON.parse(rawResult)) :
          Object.keys(JSON.parse(rawResult))
      }, 'CRITICAL: Some pages missing text after batch update - applying fallback');

      // Fix pages that didn't get text
      const fixPromises = pagesWithoutText.map((page, idx) => {
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
      pagesUpdated: updatePromises.length,
      totalStoryPages: storyPages.length,
      allPagesHaveText: updatePromises.length === storyPages.length
    }, 'Story generation completed');
    return { success: true, pagesUpdated: updatePromises.length };
    
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