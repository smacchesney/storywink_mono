/**
 * X17 B4 — pure decision matrix for the peek route. BullMQ job state +
 * book status in, one action out; the route only executes it. Keeping this
 * pure is what makes the promote/cancel/re-arm races testable.
 */
export type PeekJobState = 'delayed' | 'waiting' | 'active' | 'completed' | 'failed' | null;

export type PeekOutcome =
  | { kind: 'promote' }
  | { kind: 'already-running' }
  | { kind: 'start-fresh' }
  | { kind: 'not-waiting' }
  | { kind: 'rearm' }
  | { kind: 'already-painting' }
  | { kind: 'noop' };

export function peekOutcome(
  action: 'paint-now' | 'rearm',
  state: PeekJobState,
  bookStatus: string,
): PeekOutcome {
  if (action === 'paint-now') {
    if (state === 'delayed') return { kind: 'promote' };
    if (state === 'waiting' || state === 'active') return { kind: 'already-running' };
    if (bookStatus === 'STORY_READY') return { kind: 'start-fresh' };
    return { kind: 'not-waiting' };
  }
  if (state === 'delayed') return { kind: 'rearm' };
  if (state === 'waiting' || state === 'active' || bookStatus === 'ILLUSTRATING') {
    return { kind: 'already-painting' };
  }
  return { kind: 'noop' };
}
