import { Job } from 'bullmq';
import prisma from '../database/index.js';
import { StoryGenerationJob } from '../shared/index.js';
import OpenAI from 'openai';
import pino from 'pino';
import { 
  createVisionStoryGenerationPrompt, 
  StoryGenerationInput,
  STORY_GENERATION_SYSTEM_PROMPT,
  WinkifyStoryResponse,
  StandardStoryResponse
} from '@storywink/shared';

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

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

    // Filter out cover page to get story pages with their assets
    const storyPages = book.pages.filter(page => page.assetId !== book.coverAssetId);

    if (!storyPages || storyPages.length === 0) {
      throw new Error('Book has no story pages (excluding cover)');
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
      max_tokens: 1500,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const rawResult = completion.choices[0]?.message?.content;
    if (!rawResult) {
      throw new Error('OpenAI returned empty response');
    }

    // Parse the response based on Winkify mode
    let updatePromises: any[] = [];
    
    try {
      if (book.isWinkifyEnabled) {
        // Winkify response format: { "1": { "text": "...", "illustrationNotes": "..." }, ... }
        const winkifyResponse: WinkifyStoryResponse = JSON.parse(rawResult);
        
        logger.info({ bookId, isWinkifyEnabled: true, responseKeys: Object.keys(winkifyResponse) }, 'Parsing Winkify response');
        
        updatePromises = Object.entries(winkifyResponse)
          .map(([pageNum, content]) => {
            const storyPosition = parseInt(pageNum); // 1-based position
            const pageIndex = storyPosition - 1; // Convert to 0-based index
            const page = storyPages[pageIndex];
            
            if (page && content) {
              logger.info({ 
                bookId, 
                pageNum, 
                pageId: page.id, 
                hasText: !!content.text,
                hasIllustrationNotes: !!content.illustrationNotes 
              }, 'Updating page with Winkify content');
              
              return prisma.page.update({
                where: { id: page.id },
                data: { 
                  text: content.text?.trim() || '',
                  illustrationNotes: content.illustrationNotes || null,
                  textConfirmed: true,
                },
              });
            } else {
              logger.warn({ bookId, pageNum, storyPosition, pageIndex }, 'No page found for Winkify content');
              return null;
            }
          })
          .filter((promise) => promise !== null);
        
      } else {
        // Standard response format: { "1": "text...", "2": "text...", ... }
        const standardResponse: StandardStoryResponse = JSON.parse(rawResult);
        
        logger.info({ bookId, isWinkifyEnabled: false, responseKeys: Object.keys(standardResponse) }, 'Parsing standard response');
        
        updatePromises = Object.entries(standardResponse)
          .map(([pageNum, text]) => {
            const storyPosition = parseInt(pageNum); // 1-based position
            const pageIndex = storyPosition - 1; // Convert to 0-based index
            const page = storyPages[pageIndex];
            
            if (page) {
              logger.info({ bookId, pageNum, pageId: page.id, textLength: text.trim().length }, 'Updating page with text');
              return prisma.page.update({
                where: { id: page.id },
                data: { 
                  text: text.trim(),
                  textConfirmed: true,
                },
              });
            } else {
              logger.warn({ bookId, pageNum, storyPosition, pageIndex }, 'No page found at story position');
              return null;
            }
          })
          .filter((promise) => promise !== null);
      }
    } catch (error) {
      logger.error({ bookId, rawResult, isWinkifyEnabled: book.isWinkifyEnabled }, 'Failed to parse OpenAI response');
      throw new Error('Invalid JSON response from OpenAI');
    }

    await Promise.all(updatePromises);

    // Update book status to story ready (not yet illustrating)
    await prisma.book.update({
      where: { id: bookId },
      data: { 
        status: 'STORY_READY',
        updatedAt: new Date(),
      },
    });

    logger.info({ bookId, pagesUpdated: updatePromises.length }, 'Story generation completed');
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