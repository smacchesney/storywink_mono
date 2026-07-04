import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { BookStatus } from '@prisma/client';
import { QueueName, getQueue } from '@/lib/queue/index';
import logger from '@/lib/logger';
import { checkRateLimit } from '@/lib/rateLimit';

/**
 * POST /api/book/[bookId]/page/[pageId]/reillustrate
 *
 * Re-illustrates a single page of a COMPLETED or PARTIAL book — the
 * post-delivery fix for a page whose illustration missed. Re-enters the
 * pipeline via character extraction (which owns the illustration flow),
 * scoped to just this page via pageIds. Finalize then recomputes the
 * book status when the page finishes.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ bookId: string; pageId: string }> }
) {
  const { bookId, pageId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    const rl = await checkRateLimit(`reillustrate:${dbUser.id}`, 30, 3600);
    if (!rl.allowed) {
      logger.warn({ dbUserId: dbUser.id, key: `reillustrate:${dbUser.id}`, remaining: rl.remaining }, 'Rate limit exceeded: reillustrate page');
      if (process.env.RATE_LIMIT_ENFORCE === 'true') {
        return NextResponse.json({ error: "You're re-illustrating pages very quickly. Please wait a little while and try again." }, { status: 429 });
      }
    }

    if (!bookId || !pageId) {
      return NextResponse.json({ error: 'Missing bookId or pageId parameter' }, { status: 400 });
    }

    const book = await prisma.book.findUnique({
      where: { id: bookId, userId: dbUser.id },
      select: {
        id: true,
        status: true,
        artStyle: true,
        pages: {
          where: { id: pageId },
          select: { id: true, text: true },
        },
      },
    });

    if (!book) {
      return NextResponse.json({ error: 'Book not found or you do not have permission.' }, { status: 403 });
    }

    const page = book.pages[0];
    if (!page) {
      return NextResponse.json({ error: 'Page not found in this book.' }, { status: 404 });
    }

    const allowedStatuses: BookStatus[] = [BookStatus.COMPLETED, BookStatus.PARTIAL];

    // Conditional transition doubles as the concurrency mutex: of N
    // simultaneous taps, exactly one request moves the book to ILLUSTRATING;
    // the rest see count 0 and get a 409.
    const transition = await prisma.book.updateMany({
      where: { id: bookId, userId: dbUser.id, status: { in: allowedStatuses } },
      data: { status: BookStatus.ILLUSTRATING },
    });
    if (transition.count === 0) {
      return NextResponse.json(
        { error: `A single page can only be re-illustrated on a finished book (current status: ${book.status}).` },
        { status: 409 }
      );
    }

    // Reset the page so the illustration worker treats it as fresh work
    await prisma.page.update({
      where: { id: pageId },
      data: { moderationStatus: 'PENDING', generatedImageUrl: null },
    });

    const extractionQueue = getQueue(QueueName.CharacterExtraction);
    const extractionJob = await extractionQueue.add(
      `extract-characters-${bookId}`,
      {
        bookId,
        userId: dbUser.id,
        artStyle: book.artStyle || 'vignette',
        pageIds: [pageId],
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      }
    );

    logger.info(
      { clerkId, dbUserId: dbUser.id, bookId, pageId, extractionJobId: extractionJob.id },
      'API: Single-page re-illustration queued'
    );

    return NextResponse.json(
      { message: 'Re-illustration started for this page.', bookId, pageId },
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

    logger.error({ bookId, pageId, error }, 'API: Error queuing single-page re-illustration');
    return NextResponse.json({ error: 'Failed to start re-illustration' }, { status: 500 });
  }
}
