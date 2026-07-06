/**
 * Pure decision logic for the stuck-book reaper. Kept free of prisma/bullmq
 * imports so it can be unit-tested without a database or Redis.
 */

/** A book counts as stuck once nothing about it has changed for this long. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

/** How often the repeatable reaper sweep runs. */
export const REAPER_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Only requeues recent enough to belong to the CURRENT stall episode count
 * toward second-offense escalation. A rescued run that makes no progress is
 * re-detected within STALE_AFTER_MS + one sweep interval of the requeue
 * (the requeue resets book.updatedAt), so 24h comfortably covers a genuine
 * second offense — even one that progressed for hours before dying — while
 * ignoring requeues from earlier, resolved runs (e.g. a book rescued weeks
 * ago and regenerated today, which must get its first-offense requeue, not
 * an instant FAILED).
 */
export const REAPER_ESCALATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Staleness anchor: the most recent write across the book row and its pages.
 * Illustration workers touch pages (not the book row) as they land, so the
 * book's own updatedAt alone would reap books that are actively progressing.
 */
export function computeLastActivity(
  bookUpdatedAt: Date,
  pageUpdatedAts: ReadonlyArray<Date>,
): Date {
  let latest = bookUpdatedAt;
  for (const pageUpdatedAt of pageUpdatedAts) {
    if (pageUpdatedAt.getTime() > latest.getTime()) {
      latest = pageUpdatedAt;
    }
  }
  return latest;
}

export function isStale(
  lastActivity: Date,
  now: Date,
  staleAfterMs: number = STALE_AFTER_MS,
): boolean {
  return now.getTime() - lastActivity.getTime() >= staleAfterMs;
}

export type ReaperAction = 'requeue' | 'fail';

/**
 * First offense re-enqueues the pipeline; a book the reaper already requeued
 * once (any prior reaper_requeued AppEvent) escalates straight to FAILED.
 */
export function decideReaperAction(priorRequeueCount: number): ReaperAction {
  return priorRequeueCount >= 1 ? 'fail' : 'requeue';
}

export interface ReapablePage {
  moderationStatus: string;
  generatedImageUrl: string | null;
}

/**
 * Mirrors the retry route's page filter: completed pages (OK + illustrated)
 * are left alone, FLAGGED pages belong to the resolve flow (they need a new
 * photo, not another render), everything else is fair game.
 */
export function selectRetryablePages<T extends ReapablePage>(pages: T[]): T[] {
  return pages.filter((page) => {
    if (page.moderationStatus === 'OK' && page.generatedImageUrl) return false;
    if (page.moderationStatus === 'FLAGGED') return false;
    return true;
  });
}
