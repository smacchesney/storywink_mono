import { Job, Queue } from 'bullmq';
import prisma from '../database/index.js';
import { QUEUE_NAMES } from '@storywink/shared/constants';
import { createBullMQConnection } from '@storywink/shared/redis';
import pino from 'pino';
import {
  STALE_AFTER_MS,
  computeLastActivity,
  isStale,
  decideReaperAction,
  selectRetryablePages,
} from './book-reaper.helpers.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Lazy per-queue singletons (same pattern as story-generation.worker.ts).
const queues = new Map<string, Queue>();
function getQueue(name: string): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: createBullMQConnection() });
    queues.set(name, queue);
  }
  return queue;
}

const REAPABLE_STATUSES = ['GENERATING', 'ILLUSTRATING'] as const;

type StuckBook = NonNullable<Awaited<ReturnType<typeof findStuckCandidates>>>[number];

function findStuckCandidates(cutoff: Date) {
  // staleness = max(book.updatedAt, newest page.updatedAt), so a book can only
  // be stale if its own row is already old — the SQL prefilter never excludes
  // a genuinely stuck book, and page recency is re-checked in code below.
  return prisma.book.findMany({
    where: {
      status: { in: [...REAPABLE_STATUSES] },
      updatedAt: { lt: cutoff },
    },
    include: {
      pages: {
        orderBy: { index: 'asc' },
        select: {
          id: true,
          pageNumber: true,
          assetId: true,
          text: true,
          moderationStatus: true,
          generatedImageUrl: true,
          originalImageUrl: true,
          updatedAt: true,
          asset: { select: { url: true, thumbnailUrl: true } },
        },
      },
    },
  });
}

/**
 * Second offense: the reaper already requeued this book once and it stalled
 * again — stop burning AI spend and tell the parent. Same FAILED notification
 * shape book-finalize writes, so the bell/deep-link/email path just works.
 */
async function failStuckBook(book: StuckBook): Promise<boolean> {
  // Conditional transition = idempotency guard against a book that moved on
  // between the candidate query and now (or a concurrent sweep).
  const transition = await prisma.book.updateMany({
    where: { id: book.id, status: { in: [...REAPABLE_STATUSES] } },
    data: { status: 'FAILED' },
  });
  if (transition.count === 0) return false;

  await prisma.notification.create({
    data: {
      userId: book.userId,
      bookId: book.id,
      type: 'BOOK_FAILED',
      title: `"${book.title}" needs attention`,
      message: `There was an issue creating your book "${book.title}". Please try again.`,
    },
  });

  await prisma.appEvent.create({
    data: {
      name: 'reaper_failed',
      userId: book.userId,
      bookId: book.id,
      props: { stalledStatus: book.status },
    },
  });

  logger.warn(
    { bookId: book.id, stalledStatus: book.status },
    'Reaper: marked stuck book FAILED after a prior requeue',
  );
  return true;
}

/**
 * First offense: re-enter the pipeline exactly the way the retry route does —
 * story generation for GENERATING, character extraction (which owns the
 * illustration flow) for ILLUSTRATING. Never raw illustration jobs.
 */
async function requeueStuckBook(book: StuckBook): Promise<'requeued' | 'failed' | 'skipped'> {
  let stage: 'story' | 'illustration' | 'finalize';

  if (book.status === 'GENERATING') {
    if (book.pages.length === 0) {
      // Nothing to generate from (the retry route refuses these too). A
      // requeued story job would only fail — surface the failure now.
      return (await failStuckBook(book)) ? 'failed' : 'skipped';
    }

    stage = 'story';
    await getQueue(QUEUE_NAMES.STORY_GENERATION).add(
      `generate-story-${book.id}`,
      {
        userId: book.userId,
        bookId: book.id,
        promptContext: {
          bookTitle: book.title,
          artStyle: book.artStyle || 'vignette',
          isDoubleSpread: false,
          language: book.language || 'en',
        },
        storyPages: book.pages.map((p) => ({
          pageId: p.id,
          pageNumber: p.pageNumber,
          assetId: p.assetId,
          originalImageUrl: p.asset?.thumbnailUrl || p.asset?.url || p.originalImageUrl,
        })),
        titleWasGenerated: !book.title?.trim(),
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 10000 } },
    );
  } else {
    const retryablePages = selectRetryablePages(book.pages);

    if (retryablePages.length === 0) {
      // Every page is already illustrated or flagged — only the finalize step
      // was lost. Re-running finalize recomputes the real status and writes
      // the parent-facing notification; re-entering illustration would
      // repaint pages nobody asked to touch.
      stage = 'finalize';
      await getQueue(QUEUE_NAMES.BOOK_FINALIZE).add(
        `finalize-book-${book.id}`,
        { bookId: book.id, userId: book.userId },
        { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
      );
    } else {
      stage = 'illustration';
      await prisma.page.updateMany({
        where: { id: { in: retryablePages.map((p) => p.id) } },
        data: { moderationStatus: 'PENDING' },
      });
      await getQueue(QUEUE_NAMES.CHARACTER_EXTRACTION).add(
        `extract-characters-${book.id}`,
        {
          bookId: book.id,
          userId: book.userId,
          artStyle: book.artStyle || 'vignette',
          pageIds: retryablePages.map((p) => p.id),
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      );
    }
  }

  // Recorded AFTER the enqueue succeeds: if the enqueue fails we want the next
  // sweep to requeue again, not to escalate a book that never got its retry.
  await prisma.appEvent.create({
    data: {
      name: 'reaper_requeued',
      userId: book.userId,
      bookId: book.id,
      props: { stage, stalledStatus: book.status },
    },
  });

  // Restart the stall clock so the requeued run gets its own full window
  // before the second-offense sweep can fire.
  await prisma.book.update({
    where: { id: book.id },
    data: { updatedAt: new Date() },
  });

  logger.info({ bookId: book.id, stage, stalledStatus: book.status }, 'Reaper: requeued stuck book');
  return 'requeued';
}

/**
 * Repeatable sweep for books wedged in GENERATING/ILLUSTRATING after a worker
 * crash, Redis eviction, or lost job — the case client-side recovery can't see
 * because the parent closed the tab. First offense requeues, second marks
 * FAILED + Notification. Defensive by design: never throws out of the handler.
 */
export async function processBookReaper(job: Job) {
  const summary = { scanned: 0, requeued: 0, failed: 0, skipped: 0 };
  const now = new Date();
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);

  try {
    const candidates = await findStuckCandidates(cutoff);
    summary.scanned = candidates.length;

    for (const book of candidates) {
      try {
        const lastActivity = computeLastActivity(
          book.updatedAt,
          book.pages.map((p) => p.updatedAt),
        );
        if (!isStale(lastActivity, now)) {
          summary.skipped += 1;
          continue;
        }

        const priorRequeues = await prisma.appEvent.count({
          where: { name: 'reaper_requeued', bookId: book.id },
        });

        if (decideReaperAction(priorRequeues) === 'fail') {
          if (await failStuckBook(book)) {
            summary.failed += 1;
          } else {
            summary.skipped += 1;
          }
        } else {
          const outcome = await requeueStuckBook(book);
          if (outcome === 'requeued') summary.requeued += 1;
          else if (outcome === 'failed') summary.failed += 1;
          else summary.skipped += 1;
        }
      } catch (error) {
        // One broken book must not stop the sweep for the rest.
        logger.error(
          {
            bookId: book.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'Reaper: failed to process stuck book',
        );
      }
    }

    if (summary.scanned > 0) {
      logger.info({ jobId: job.id, ...summary }, 'Reaper sweep finished');
    }
  } catch (error) {
    logger.error(
      { jobId: job.id, error: error instanceof Error ? error.message : String(error) },
      'Reaper sweep failed',
    );
  }

  return summary;
}
