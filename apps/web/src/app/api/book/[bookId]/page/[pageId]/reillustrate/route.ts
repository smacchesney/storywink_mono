import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { BookStatus } from '@prisma/client';
import { QueueName, getQueue } from '@/lib/queue/index';
import logger from '@/lib/logger';

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
    if (!allowedStatuses.includes(book.status)) {
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

    await prisma.book.update({
      where: { id: bookId },
      data: { status: BookStatus.ILLUSTRATING },
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
