/**
 * X17 B4 — grace-window peek plumbing (workers side). STORY_PEEK_GRACE_MS
 * unset or 0 keeps today's immediate auto-chain byte-for-byte; a positive
 * value arms the chain as a cancellable delayed job instead. The web peek
 * route promotes it (paint now) or removes + re-adds it (tweak re-arm) by
 * its deterministic job id. Rollback = unset the var. The web-side copy of
 * the grace default lives in the peek route — the two sides must agree.
 */
export const DEFAULT_STORY_PEEK_GRACE_MS = 180_000;

export function storyPeekGraceMs(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.STORY_PEEK_GRACE_MS ?? '').trim();
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** The auto-chain's delayed job id. The legacy immediate chain sets only a
 * job NAME (story-generation.worker.ts:1721) — promote/cancel from the web
 * needs a deterministic id. */
export function peekExtractJobId(bookId: string): string {
  return `peek-extract-${bookId}`;
}

export interface AutoChainPlan {
  mode: 'none' | 'immediate' | 'delayed';
  delayMs: number;
}

export function resolveAutoChainPlan(input: {
  autoIllustrate: boolean;
  bookType: string;
  graceMs: number;
}): AutoChainPlan {
  if (!input.autoIllustrate) return { mode: 'none', delayMs: 0 };
  if (input.bookType === 'AVATAR_STORY' || input.graceMs <= 0) {
    return { mode: 'immediate', delayMs: 0 };
  }
  return { mode: 'delayed', delayMs: input.graceMs };
}

/**
 * A delayed peek job must claim the book (STORY_READY → ILLUSTRATING) when
 * it finally runs — the enqueuer deliberately did not. Proceed when this
 * job's claim landed (count > 0). When the claim found nothing but the book
 * is already ILLUSTRATING, proceed ONLY on a genuine retry — `attemptsMade`
 * greater than 0 means an earlier attempt of THIS job claimed and then
 * failed mid-run, so it must not strand the book. A fresh attempt
 * (attemptsMade 0) that finds a foreign ILLUSTRATING must not adopt it: the
 * de-arm ordering makes coexistence unlikely, but this closes the rearm /
 * de-arm TOCTOU window rather than trusting the status alone. Every other
 * path that sets ILLUSTRATING (the manual illustrations route, the peek
 * route's start-fresh) first removes any armed peek-extract job.
 */
export function shouldRunAfterClaim(
  claimedCount: number,
  currentStatus: string | null | undefined,
  attemptsMade: number,
): boolean {
  if (claimedCount > 0) return true;
  return currentStatus === 'ILLUSTRATING' && attemptsMade > 0;
}
