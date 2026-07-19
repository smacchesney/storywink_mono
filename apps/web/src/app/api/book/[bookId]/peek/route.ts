import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { QueueName, getQueue } from '@/lib/queue/index';
import { createDiscoveryEnabled } from '@/lib/discovery';
import { peekOutcome, type PeekJobState } from '@/lib/peek-plan';
import { checkRateLimit } from '@/lib/rateLimit';
import logger from '@/lib/logger';

const peekRequestSchema = z.object({ action: z.enum(['paint-now', 'rearm']) });

/** Mirror of the workers' default (peek.ts) — the two sides must agree. A
 * re-arm only ever happens when a delayed job exists, i.e. workers had the
 * var set; the default covers a web env that omits it. */
const DEFAULT_STORY_PEEK_GRACE_MS = 180_000;
function graceMs(): number {
  const raw = (process.env.STORY_PEEK_GRACE_MS ?? '').trim();
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_STORY_PEEK_GRACE_MS;
}

type RouteContext = { params: Promise<{ bookId: string }> };

/**
 * X17 B4 — grace-window controls. paint-now promotes the delayed
 * character-extraction job (or starts the chain when none is armed); rearm
 * cancels + re-adds it with a fresh window after a tweak. Nothing here can
 * stall a book: every path either advances it or leaves it STORY_READY with
 * the manual start intact.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  if (!createDiscoveryEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const { bookId } = await params;
  try {
    const { dbUser } = await getAuthenticatedUser();

    // Write op — rate-limit per house rules (fail-open; enforced only when
    // RATE_LIMIT_ENFORCE=true). paint-now/rearm are cheap queue ops, so the
    // window is generous: it only bounds abusive automation, never a parent
    // tweaking the ramble a handful of times inside the grace window.
    const rl = await checkRateLimit(`peek:${dbUser.id}`, 60, 60);
    if (!rl.allowed) {
      logger.warn(
        { dbUserId: dbUser.id, key: `peek:${dbUser.id}`, remaining: rl.remaining },
        'Rate limit exceeded: peek action',
      );
      if (process.env.RATE_LIMIT_ENFORCE === 'true') {
        return NextResponse.json(
          { error: "You're doing that very quickly. Please wait a moment and try again." },
          { status: 429 },
        );
      }
    }

    const parsed = peekRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const book = await prisma.book.findUnique({
      where: { id: bookId, userId: dbUser.id },
      select: { status: true, artStyle: true, bookType: true },
    });
    if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

    // Avatar books never arm a grace-window peek (they use the immediate
    // auto-chain — resolveAutoChainPlan), so there is no peek surface for
    // them. 404 to match the flag-off shape: this endpoint does not exist
    // for an avatar book.
    if (book.bookType === 'AVATAR_STORY') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const queue = getQueue(QueueName.CharacterExtraction);
    const jobId = `peek-extract-${bookId}`;
    const job = await queue.getJob(jobId);
    const state = (job ? await job.getState() : null) as PeekJobState;
    const outcome = peekOutcome(parsed.data.action, state, book.status);
    logger.info(
      { bookId, dbUserId: dbUser.id, action: parsed.data.action, state, outcome: outcome.kind },
      'Peek action',
    );

    switch (outcome.kind) {
      case 'promote':
        // The delay can elapse between getState() and promote() — the job is
        // then simply running, which is exactly what the caller asked for.
        await job!.promote().catch(() => {});
        return NextResponse.json({ started: true }, { status: 202 });
      case 'already-running':
        return NextResponse.json({ started: true, alreadyRunning: true }, { status: 202 });
      case 'start-fresh': {
        // No armed job (grace off on workers, or a lost enqueue) — start the
        // chain the way the illustrations route does.
        await prisma.book.update({ where: { id: bookId }, data: { status: 'ILLUSTRATING' } });
        try {
          await queue.add(
            `extract-characters-${bookId}`,
            { bookId, userId: dbUser.id, artStyle: book.artStyle || 'vignette' },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 10000 },
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 500 },
            },
          );
        } catch (addError) {
          // Enqueue failed after the status flip — revert ILLUSTRATING →
          // STORY_READY so the book isn't stranded (the manual start would
          // otherwise 409). House revert-catch idiom from
          // story-generation.worker.ts; the parent can retry the 500.
          logger.error(
            {
              bookId,
              dbUserId: dbUser.id,
              error: addError instanceof Error ? addError.message : 'Unknown error',
            },
            'Peek start-fresh enqueue failed — reverting to STORY_READY',
          );
          await prisma.book
            .updateMany({
              where: { id: bookId, status: 'ILLUSTRATING' },
              data: { status: 'STORY_READY' },
            })
            .catch(() => {});
          return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
        }
        return NextResponse.json({ started: true }, { status: 202 });
      }
      case 'not-waiting':
        return NextResponse.json(
          { error: 'Book is not waiting to illustrate', code: 'NOT_WAITING' },
          { status: 409 },
        );
      case 'rearm': {
        const data = job!.data as Record<string, unknown>;
        try {
          await job!.remove();
        } catch {
          // The delay elapsed and the job went active between getState() and
          // remove() — painting has started; report it instead of a 500. The
          // earlier 'Peek action' log recorded outcome:'rearm'; log the
          // conversion so the logs match the ALREADY_PAINTING response.
          logger.info(
            { bookId, dbUserId: dbUser.id, action: parsed.data.action },
            'Peek rearm raced painting — converted to ALREADY_PAINTING',
          );
          return NextResponse.json({ rearmed: false, code: 'ALREADY_PAINTING' }, { status: 409 });
        }
        await queue.add(`extract-characters-${bookId}`, data, {
          jobId,
          delay: graceMs(),
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        });
        return NextResponse.json({ rearmed: true }, { status: 200 });
      }
      case 'already-painting':
        return NextResponse.json({ rearmed: false, code: 'ALREADY_PAINTING' }, { status: 409 });
      case 'noop':
        return NextResponse.json({ rearmed: false }, { status: 200 });
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('not authenticated') ||
        error.message.includes('ID mismatch') ||
        error.message.includes('primary email not found'))
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    logger.error({ bookId, error }, 'Peek action failed');
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
