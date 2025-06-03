import { Job } from 'bullmq';
import prisma from '../database/index.js';
import { BookFinalizeJob, categorizePages, isTitlePage } from '../shared/index.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export async function processBookFinalize(job: Job<BookFinalizeJob>) {
  const { bookId, userId } = job.data;
  
  logger.info({ bookId, userId, jobId: job.id }, 'Starting book finalization');
  console.log(`[BookFinalize] Starting finalization for book ${bookId} (job: ${job.id})`);
  
  try {
    // Get book with all pages
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        pages: {
          orderBy: { pageNumber: 'asc' },
        },
      },
    });
    
    if (!book) {
      throw new Error('Book not found');
    }
    
    // Check completion status
    // Title pages don't need text, so we filter them out for text completion check
    // Use consistent logic across the entire application
    const { storyPages, titlePages } = categorizePages(book.pages, book.coverAssetId);
    
    const pagesWithText = book.pages.filter((p: any) => p.text && p.text.trim().length > 0);
    const storyPagesWithText = storyPages.filter((p: any) => p.text && p.text.trim().length > 0);
    const pagesWithIllustrations = book.pages.filter((p: any) => p.generatedImageUrl);
    const pagesWithFailedModeration = book.pages.filter((p: any) => p.moderationStatus === 'FAILED');
    
    const totalPages = book.pages.length;
    // Text is complete if all story pages have text (title pages don't need text)
    const textComplete = storyPagesWithText.length === storyPages.length;
    const illustrationsComplete = pagesWithIllustrations.length === totalPages;
    
    logger.info({ 
      bookId,
      totalPages,
      titlePages: titlePages.length,
      storyPages: storyPages.length,
      pagesWithText: pagesWithText.length,
      storyPagesWithText: storyPagesWithText.length,
      pagesWithIllustrations: pagesWithIllustrations.length,
      pagesWithFailedModeration: pagesWithFailedModeration.length,
      textComplete,
      illustrationsComplete
    }, 'Book completion status analysis');
    
    console.log(`[BookFinalize] Book ${bookId} analysis:`)
    console.log(`  - Total Pages: ${totalPages} (${titlePages.length} title, ${storyPages.length} story)`)
    console.log(`  - Story Pages with Text: ${storyPagesWithText.length}/${storyPages.length}`)
    console.log(`  - Pages with Illustrations: ${pagesWithIllustrations.length}/${totalPages}`)
    console.log(`  - Text Complete: ${textComplete}`)
    console.log(`  - Illustrations Complete: ${illustrationsComplete}`)
    
    // Detailed page analysis
    console.log(`[BookFinalize] Detailed page analysis:`)
    book.pages.forEach((page: any) => {
      const isActualTitlePage = isTitlePage(page.assetId, book.coverAssetId);
      console.log(`  - Page ${page.pageNumber}:`)
      console.log(`    - ID: ${page.id}`)
      console.log(`    - Asset ID: ${page.assetId}`)
      console.log(`    - Cover Asset ID: ${book.coverAssetId}`)
      console.log(`    - Is Title Page (DB): ${page.isTitlePage}`)
      console.log(`    - Is Title Page (Logic): ${isActualTitlePage}`)
      console.log(`    - Has Text: ${!!page.text} (${page.text?.length || 0} chars)`)
      console.log(`    - Has Illustration: ${!!page.generatedImageUrl}`)
      console.log(`    - Moderation Status: ${page.moderationStatus || 'N/A'}`)
    });
    
    let finalStatus: 'COMPLETED' | 'PARTIAL' | 'FAILED';
    
    if (textComplete && illustrationsComplete) {
      finalStatus = 'COMPLETED';
    } else if (illustrationsComplete) {
      // If all illustrations are done, consider it as COMPLETED even if some story pages lack text
      // This handles cases where story generation had issues but illustrations succeeded
      console.log(`[BookFinalize] All illustrations complete, treating as COMPLETED despite missing text on some pages`);
      finalStatus = 'COMPLETED';
    } else if (pagesWithText.length > 0 || pagesWithIllustrations.length > 0) {
      finalStatus = 'PARTIAL';
    } else {
      finalStatus = 'FAILED';
    }
    
    // Update book status
    await prisma.book.update({
      where: { id: bookId },
      data: { 
        status: finalStatus,
        updatedAt: new Date(),
      },
    });
    
    logger.info({ 
      bookId, 
      finalStatus,
      totalPages,
      pagesWithText: pagesWithText.length,
      pagesWithIllustrations: pagesWithIllustrations.length,
      jobId: job.id
    }, 'Book finalization completed');
    
    console.log(`[BookFinalize] Finalization completed for book ${bookId} with status: ${finalStatus}`);
    
    return { 
      success: true, 
      status: finalStatus,
      totalPages,
      pagesWithText: pagesWithText.length,
      pagesWithIllustrations: pagesWithIllustrations.length
    };
    
  } catch (error: any) {
    logger.error({ bookId, error: error.message }, 'Book finalization failed');
    
    // Update book status to failed
    await prisma.book.update({
      where: { id: bookId },
      data: { status: 'FAILED' },
    }).catch(() => {}); // Ignore errors when updating status
    
    throw error;
  }
}