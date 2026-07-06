import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { BookStatus } from '@prisma/client';
import { QueueName, getQueue } from '@/lib/queue/index';
import logger from '@/lib/logger';

/**
 * POST /api/book/[bookId]/retry
 *
 * One status-aware retry for every failure surface (library card, preview
 * banner, progress screen). Decides the re-entry stage itself:
 * - No page has text yet  → re-run story generation.
 * - Texts exist           → reset failed/missing illustrations and re-enter
 *                           via character extraction (which owns the flow).
 * FLAGGED pages are never auto-retried — the resolve flow handles those.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    const book = await prisma.book.findUnique({
      where: { id: bookId, userId: dbUser.id },
      include: {
        pages: {
          orderBy: { index: 'asc' },
          select: {
            id: true,
            text: true,
            moderationStatus: true,
            generatedImageUrl: true,
          },
        },
      },
    });

    if (!book) {
      return NextResponse.json({ error: 'Book not found or you do not have permission.' }, { status: 403 });
    }

    if (book.status === BookStatus.GENERATING || book.status === BookStatus.ILLUSTRATING) {
      return NextResponse.json(
        { error: 'This book is already being worked on.', status: book.status },
        { status: 409 }
      );
    }
    if (book.status === BookStatus.COMPLETED) {
      return NextResponse.json(
        { error: 'This book is already complete.', status: book.status },
        { status: 409 }
      );
    }
    if (!book.pages.length) {
      return NextResponse.json({ error: 'Cannot retry a book with no pages.' }, { status: 400 });
    }

    const pagesWithText = book.pages.filter(p => p.text && p.text.trim().length > 0);

    if (pagesWithText.length === 0) {
      // Story never landed — re-run story generation from scratch. The
      // conditional transition is the concurrency mutex for double-taps.
      const transition = await prisma.book.updateMany({
        where: {
          id: bookId,
          userId: dbUser.id,
          status: { in: [BookStatus.FAILED, BookStatus.PARTIAL, BookStatus.DRAFT] },
        },
        data: { status: BookStatus.GENERATING },
      });
      if (transition.count === 0) {
        return NextResponse.json({ error: 'This book is already being worked on.' }, { status: 409 });
      }

      const fullPages = await prisma.page.findMany({
        where: { bookId },
        orderBy: { index: 'asc' },
        include: { asset: { select: { url: true, thumbnailUrl: true } } },
      });

      await getQueue(QueueName.StoryGeneration).add(
        `generate-story-${bookId}`,
        {
          userId: dbUser.id,
          bookId,
          promptContext: {
            bookTitle: book.title,
            artStyle: book.artStyle || 'vignette',
            isDoubleSpread: false,
            language: book.language || 'en',
          },
          storyPages: fullPages.map(p => ({
            pageId: p.id,
            pageNumber: p.pageNumber,
            assetId: p.assetId,
            originalImageUrl: p.asset?.thumbnailUrl || p.asset?.url || p.originalImageUrl,
          })),
          titleWasGenerated: !book.title?.trim(),
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 10000 } }
      );

      logger.info({ clerkId, bookId, stage: 'story' }, 'API: Retry re-queued story generation');
      return NextResponse.json({ message: 'Story generation restarted.', bookId, stage: 'story' }, { status: 202 });
    }

    // Illustration retry: reset failed/missing pages (never FLAGGED — those
    // need a new photo via the resolve flow) and re-enter via extraction.
    const retryablePages = book.pages.filter(p => {
      if (p.moderationStatus === 'OK' && p.generatedImageUrl) return false;
      if (p.moderationStatus === 'FLAGGED') return false;
      return true;
    });

    if (retryablePages.length === 0) {
      const flaggedCount = book.pages.filter(p => p.moderationStatus === 'FLAGGED').length;
      return NextResponse.json(
        {
          message: flaggedCount > 0
            ? `${flaggedCount} page(s) were flagged by content policy and need a different photo.`
            : 'Nothing to retry.',
          bookId,
          flaggedCount,
        },
        { status: 200 }
      );
    }

    // Conditional transition = concurrency mutex for double-taps.
    const transition = await prisma.book.updateMany({
      where: {
        id: bookId,
        userId: dbUser.id,
        status: { in: [BookStatus.FAILED, BookStatus.PARTIAL, BookStatus.STORY_READY] },
      },
      data: { status: BookStatus.ILLUSTRATING },
    });
    if (transition.count === 0) {
      return NextResponse.json({ error: 'This book is already being worked on.' }, { status: 409 });
    }
    await prisma.page.updateMany({
      where: { id: { in: retryablePages.map(p => p.id) } },
      data: { moderationStatus: 'PENDING' },
    });

    await getQueue(QueueName.CharacterExtraction).add(
      `extract-characters-${bookId}`,
      {
        bookId,
        userId: dbUser.id,
        artStyle: book.artStyle || 'vignette',
        pageIds: retryablePages.map(p => p.id),
        // Book-level retry: pageIds scope the render children (already-OK
        // pages are not repainted) but finalize must still run the book-wide
        // QC pass and palette normalization.
        recovery: true,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      }
    );

    logger.info(
      { clerkId, bookId, stage: 'illustration', pageCount: retryablePages.length },
      'API: Retry re-queued illustration via character extraction'
    );
    return NextResponse.json(
      { message: `Retrying ${retryablePages.length} page(s).`, bookId, stage: 'illustration' },
      { status: 202 }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('not authenticated') ||
        error.message.includes('ID mismatch') ||
        error.message.includes('primary email not found'))
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    logger.error({ bookId, error }, 'API: Error in retry endpoint');
    return NextResponse.json({ error: 'Failed to retry' }, { status: 500 });
  }
}
