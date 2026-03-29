import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { z } from 'zod';
import { QueueName, getQueue } from '@/lib/queue/index';
import { db as prisma } from '@/lib/db';
import { BookStatus } from '@prisma/client';
import logger from '@/lib/logger';

// Define the expected input schema using Zod
const illustrationRequestSchema = z.object({
  bookId: z.string().cuid({ message: "Valid Book ID (CUID) is required" }),
  pageIds: z.array(z.string().cuid()).optional(),
});

// Job data is now assembled by the character-extraction worker, not this endpoint.

export async function POST(request: Request) {
  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    let requestData;
    try {
      const rawData = await request.json();
      requestData = illustrationRequestSchema.parse(rawData);
      logger.info({ clerkId, dbUserId: dbUser.id, bookId: requestData.bookId }, 'Received illustration generation request');
    } catch (error) {
      logger.error({ clerkId, dbUserId: dbUser.id, error }, 'Invalid illustration generation request data');
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'Invalid input data', details: error.errors }, { status: 400 });
      }
      return NextResponse.json({ error: 'Failed to parse request data' }, { status: 400 });
    }

    // Step 1: Validate Book Ownership and Status
    logger.info({ clerkId, dbUserId: dbUser.id, bookId: requestData.bookId }, 'Validating book...');
    const book = await prisma.book.findUnique({
      where: {
        id: requestData.bookId,
        userId: dbUser.id, // Use database user ID for ownership check
      },
      select: {
        id: true,
        title: true,
        artStyle: true,
        status: true,
        coverAssetId: true, // Include coverAssetId to identify title page
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
            moderationStatus: true,
            generatedImageUrl: true,
          }
        }
      }
    });

    if (!book) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId: requestData.bookId }, 'Book not found or user mismatch for illustration generation.');
      return NextResponse.json({ error: 'Book not found or access denied.' }, { status: 404 });
    }

    // Prevent re-illustration of already completed books (but allow retry for PARTIAL/FAILED)
    if (book.status === BookStatus.COMPLETED) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId: requestData.bookId, status: book.status }, 'Rejected illustration request for already-completed book.');
      return NextResponse.json({
        error: 'Book already illustrated',
        message: 'This book has already been illustrated and cannot be re-illustrated.',
        status: book.status
      }, { status: 409 });
    }

    // Book must be in STORY_READY, PARTIAL, or FAILED state to start/retry illustration
    const allowedStatuses: BookStatus[] = [BookStatus.STORY_READY, BookStatus.PARTIAL, BookStatus.FAILED];
    if (!allowedStatuses.includes(book.status)) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId: requestData.bookId, status: book.status }, 'Book not in correct state for illustration generation.');
      return NextResponse.json({ error: `Book must be in STORY_READY, PARTIAL, or FAILED state to start illustration (current: ${book.status})` }, { status: 409 });
    }

    // Log if this is a retry
    if (book.status === BookStatus.PARTIAL || book.status === BookStatus.FAILED) {
      logger.info({ clerkId, dbUserId: dbUser.id, bookId: requestData.bookId, status: book.status }, 'Retrying illustration for failed/partial book.');
    }

    if (!book.pages || book.pages.length === 0) {
       logger.error({ clerkId, dbUserId: dbUser.id, bookId: book.id }, 'No pages found for this book to illustrate.');
       return NextResponse.json({ error: 'Cannot illustrate a book with no pages.' }, { status: 400 });
    }

    // Smart Retry: Only process pages that need illustration
    const isRetry = book.status === BookStatus.PARTIAL || book.status === BookStatus.FAILED;

    let pagesToProcess = book.pages;

    // If specific pageIds were requested, filter to those pages only
    if (requestData.pageIds && requestData.pageIds.length > 0) {
      const requestedIds = new Set(requestData.pageIds);
      pagesToProcess = book.pages.filter((page) => requestedIds.has(page.id));

      // Reset moderation status for requested pages so they get re-processed
      for (const page of pagesToProcess) {
        await prisma.page.update({
          where: { id: page.id },
          data: { moderationStatus: 'PENDING', generatedImageUrl: null },
        });
      }

      logger.info({
        clerkId,
        dbUserId: dbUser.id,
        bookId: book.id,
        requestedPageIds: requestData.pageIds,
        matchedPages: pagesToProcess.length,
      }, 'Specific pageIds requested for illustration');
    } else if (isRetry) {
      pagesToProcess = book.pages.filter((page) => {
        // Skip pages with successful illustrations (OK status)
        if (page.moderationStatus === 'OK' && page.generatedImageUrl) {
          return false;
        }
        // Skip pages flagged by content policy (retrying won't help)
        if (page.moderationStatus === 'FLAGGED') {
          return false;
        }
        // Include pages with FAILED status (transient errors) or missing illustrations
        return true;
      });

      const skippedOk = book.pages.filter(p => p.moderationStatus === 'OK' && p.generatedImageUrl).length;
      const skippedFlagged = book.pages.filter(p => p.moderationStatus === 'FLAGGED').length;

      logger.info({
        clerkId,
        dbUserId: dbUser.id,
        bookId: book.id,
        totalPages: book.pages.length,
        pagesToRetry: pagesToProcess.length,
        skippedOk,
        skippedFlagged
      }, 'Smart retry - filtering to failed/missing pages only');

      console.log(`[IllustrationAPI] Smart Retry Mode:`);
      console.log(`  - Total Pages: ${book.pages.length}`);
      console.log(`  - Pages to Retry: ${pagesToProcess.length}`);
      console.log(`  - Skipped (OK): ${skippedOk}`);
      console.log(`  - Skipped (FLAGGED - content policy): ${skippedFlagged}`);
    }

    // Handle edge case: no pages to retry
    if (isRetry && pagesToProcess.length === 0) {
      const flaggedCount = book.pages.filter(p => p.moderationStatus === 'FLAGGED').length;
      const okCount = book.pages.filter(p => p.moderationStatus === 'OK' && p.generatedImageUrl).length;

      if (flaggedCount > 0 && okCount === book.pages.length - flaggedCount) {
        // All non-flagged pages succeeded, but some are flagged
        // Keep as PARTIAL - user needs to address flagged content (Phase 2)
        logger.info({
          clerkId,
          dbUserId: dbUser.id,
          bookId: book.id,
          flaggedCount,
          okCount
        }, 'No pages to retry - all remaining are FLAGGED by content policy');

        return NextResponse.json({
          message: `${flaggedCount} page(s) were flagged by content policy and cannot be retried. Please edit your book to remove flagged photos.`,
          bookId: book.id,
          flaggedCount,
          status: 'PARTIAL'
        }, { status: 200 });
      }

      // All pages succeeded - update to COMPLETED
      await prisma.book.update({
        where: { id: book.id },
        data: { status: BookStatus.COMPLETED }
      });

      logger.info({
        clerkId,
        dbUserId: dbUser.id,
        bookId: book.id
      }, 'All pages already have successful illustrations - marking as COMPLETED');

      return NextResponse.json({
        message: 'All pages already have successful illustrations.',
        bookId: book.id,
        status: 'COMPLETED'
      }, { status: 200 });
    }

    logger.info({
      clerkId,
      dbUserId: dbUser.id,
      bookId: book.id,
      pageCount: book.pages.length,
      currentStatus: book.status,
      artStyle: book.artStyle
    }, 'Book validation successful.');

    console.log(`[IllustrationAPI] Starting illustration for book ${book.id}:`);
    console.log(`  - Title: ${book.title}`);
    console.log(`  - Pages: ${book.pages.length}`);
    console.log(`  - Art Style: ${book.artStyle}`);

    // Step 2: Update Book Status to ILLUSTRATING
    await prisma.book.update({
        where: { id: book.id },
        data: { status: BookStatus.ILLUSTRATING }
    });
    logger.info({ clerkId, dbUserId: dbUser.id, bookId: book.id }, 'Book status updated to ILLUSTRATING.');

    // Step 3: Queue character extraction job
    // The extraction worker will analyze all photos for character identity,
    // then create the FlowProducer illustration flow with characterIdentity
    // baked into each illustration job's data.
    const extractionQueue = getQueue(QueueName.CharacterExtraction);

    const extractionJob = await extractionQueue.add(
      `extract-characters-${book.id}`,
      {
        bookId: book.id,
        userId: dbUser.id,
        artStyle: book.artStyle || 'vignette',
        ...(requestData.pageIds?.length && { pageIds: requestData.pageIds }),
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      }
    );

    logger.info({
      clerkId,
      dbUserId: dbUser.id,
      bookId: book.id,
      pageCount: pagesToProcess.length,
      artStyle: book.artStyle,
      extractionJobId: extractionJob.id,
    }, 'Queued character extraction job (will create illustration flow on completion)');

    console.log(`[IllustrationAPI] Character extraction job queued for book ${book.id}`);
    console.log(`  - Extraction Job ID: ${extractionJob.id}`);
    console.log(`  - Pages to illustrate: ${pagesToProcess.length}`);

    // Step 4: Return confirmation
    return NextResponse.json({
      message: `Character extraction started. ${pagesToProcess.length} pages will be illustrated after extraction.`,
      bookId: book.id,
      extractionJobId: extractionJob.id,
    }, { status: 202 });

  } catch (error: any) {
    // Handle authentication errors first
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      logger.warn('Unauthorized illustration generation attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // For other errors, extract bookId if available
    const bookId = error?.requestData?.bookId || 'unknown';
    logger.error({ bookId, error: error.message }, 'Error during illustration job queuing or validation');
    // Attempt to revert status - maybe move status update to finalize job?
    // For now, just log the error and return 500
    return NextResponse.json({ error: error.message || 'An unexpected error occurred' }, { status: 500 });
  }
} 