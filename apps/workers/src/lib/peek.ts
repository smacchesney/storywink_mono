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
 * job's claim landed, or when the book is already ILLUSTRATING: that is the
 * RETRY case (attempt 1 claimed, then failed mid-run — attempt 2 must not
 * strand the book). It is never a foreign start: every other path that sets
 * ILLUSTRATING (the manual illustrations route, the peek route's
 * start-fresh) first removes any armed peek-extract job, so a live delayed
 * job cannot coexist with someone else's ILLUSTRATING.
 */
export function shouldRunAfterClaim(
  claimedCount: number,
  currentStatus: string | null | undefined,
): boolean {
  return claimedCount > 0 || currentStatus === 'ILLUSTRATING';
}
