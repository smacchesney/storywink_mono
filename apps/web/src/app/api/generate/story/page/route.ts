import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { BookStatus } from '@prisma/client';
import { z } from 'zod';
import { getQueue, QueueName } from '@/lib/queue';
import logger from '@/lib/logger';

const requestSchema = z.object({
  bookId: z.string().cuid(),
  pageId: z.string().cuid(),
});

/**
 * POST /api/generate/story/page
 * Queues single-page text regeneration through the story worker.
 * Used when a user replaces a flagged photo and needs new text.
 */
export async function POST(req: NextRequest) {
  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    const { bookId, pageId } = requestSchema.parse(body);

    // Verify book ownership and status
    const book = await prisma.book.findUnique({
      where: { id: bookId, userId: dbUser.id },
      select: { id: true, status: true },
    });

    if (!book) {
      return NextResponse.json({ error: 'Book not found or access denied.' }, { status: 404 });
    }

    if (book.status !== BookStatus.PARTIAL) {
      return NextResponse.json(
        { error: `Single-page text generation only available for PARTIAL books (current: ${book.status})` },
        { status: 409 }
      );
    }

    // Verify page exists in this book
    const page = await prisma.page.findFirst({
      where: { id: pageId, bookId },
      select: { id: true },
    });

    if (!page) {
      return NextResponse.json({ error: 'Page not found in this book.' }, { status: 404 });
    }

    // Queue single-page text generation job
    const storyQueue = getQueue(QueueName.StoryGeneration);
    const job = await storyQueue.add(
      `generate-story-page-${bookId}-${pageId}`,
      {
        bookId,
        userId: dbUser.id,
        singlePageId: pageId,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      }
    );

    logger.info(
      { clerkId, dbUserId: dbUser.id, bookId, pageId, jobId: job.id },
      'API: Queued single-page text generation job'
    );

    return NextResponse.json({
      message: 'Single-page text generation started',
      bookId,
      pageId,
      jobId: job.id,
    }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request data', details: error.errors }, { status: 400 });
    }

    if (
      error instanceof Error &&
      (error.message.includes('not authenticated') ||
        error.message.includes('ID mismatch') ||
        error.message.includes('primary email not found'))
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, 'API: Error queuing single-page text generation');
    return NextResponse.json({ error: 'Failed to start text generation' }, { status: 500 });
  }
}
