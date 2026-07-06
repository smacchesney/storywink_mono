import { describe, it, expect } from 'vitest';
import {
  STALE_AFTER_MS,
  REAPER_INTERVAL_MS,
  REAPER_ESCALATION_WINDOW_MS,
  computeLastActivity,
  isStale,
  decideReaperAction,
  selectRetryablePages,
  type ReapablePage,
} from './book-reaper.helpers.js';

const T0 = new Date('2026-07-05T12:00:00.000Z');
const minutes = (n: number) => n * 60 * 1000;
const at = (offsetMin: number) => new Date(T0.getTime() + minutes(offsetMin));

describe('computeLastActivity', () => {
  it('returns the book timestamp when there are no pages', () => {
    expect(computeLastActivity(T0, [])).toEqual(T0);
  });

  it('returns the book timestamp when it is newer than every page', () => {
    expect(computeLastActivity(at(10), [at(-5), at(0)])).toEqual(at(10));
  });

  it('returns the newest page timestamp when a page outdates the book row', () => {
    // Illustration workers touch pages, not the book — this is the case that
    // keeps actively-progressing books out of the reaper.
    expect(computeLastActivity(T0, [at(3), at(25), at(7)])).toEqual(at(25));
  });
});

describe('isStale', () => {
  it('is not stale just under the threshold', () => {
    const lastActivity = T0;
    const now = new Date(T0.getTime() + STALE_AFTER_MS - 1);
    expect(isStale(lastActivity, now)).toBe(false);
  });

  it('is stale exactly at the threshold', () => {
    const now = new Date(T0.getTime() + STALE_AFTER_MS);
    expect(isStale(T0, now)).toBe(true);
  });

  it('respects a custom threshold', () => {
    expect(isStale(T0, at(5), minutes(10))).toBe(false);
    expect(isStale(T0, at(15), minutes(10))).toBe(true);
  });
});

describe('decideReaperAction', () => {
  it('requeues on the first offense', () => {
    expect(decideReaperAction(0)).toBe('requeue');
  });

  it('fails on the second offense', () => {
    expect(decideReaperAction(1)).toBe('fail');
  });

  it('fails when multiple prior requeues exist', () => {
    expect(decideReaperAction(3)).toBe('fail');
  });
});

describe('REAPER_ESCALATION_WINDOW_MS', () => {
  it('covers a genuine second offense: re-detection lands within staleness + one sweep of the requeue', () => {
    // A requeue resets book.updatedAt; a zero-progress rescued run trips
    // staleness again after STALE_AFTER_MS and the next sweep escalates it.
    // The window must comfortably contain that, or escalation never fires.
    const reDetectionMs = STALE_AFTER_MS + REAPER_INTERVAL_MS;
    expect(REAPER_ESCALATION_WINDOW_MS).toBeGreaterThan(2 * reDetectionMs);
  });

  it('excludes requeues from earlier, resolved runs (episode scoping, not lifetime)', () => {
    // A book rescued weeks ago and regenerated today must get its
    // first-offense requeue, not an instant FAILED.
    const weeks = (n: number) => n * 7 * 24 * 60 * 60 * 1000;
    expect(REAPER_ESCALATION_WINDOW_MS).toBeLessThan(weeks(1));
  });
});

describe('selectRetryablePages', () => {
  const page = (overrides: Partial<ReapablePage> = {}): ReapablePage => ({
    moderationStatus: 'PENDING',
    generatedImageUrl: null,
    ...overrides,
  });

  it('skips completed pages (OK + illustrated)', () => {
    const done = page({ moderationStatus: 'OK', generatedImageUrl: 'https://cdn.example/p.png' });
    expect(selectRetryablePages([done])).toEqual([]);
  });

  it('skips FLAGGED pages — the resolve flow owns those', () => {
    const flagged = page({ moderationStatus: 'FLAGGED' });
    expect(selectRetryablePages([flagged])).toEqual([]);
  });

  it('keeps pending pages without an illustration', () => {
    const pending = page();
    expect(selectRetryablePages([pending])).toEqual([pending]);
  });

  it('keeps OK pages whose illustration never landed', () => {
    const okNoImage = page({ moderationStatus: 'OK', generatedImageUrl: null });
    expect(selectRetryablePages([okNoImage])).toEqual([okNoImage]);
  });

  it('keeps FAILED-moderation pages', () => {
    const failed = page({ moderationStatus: 'FAILED' });
    expect(selectRetryablePages([failed])).toEqual([failed]);
  });

  it('filters a mixed book down to just the retryable pages', () => {
    const done = page({ moderationStatus: 'OK', generatedImageUrl: 'https://cdn.example/p.png' });
    const flagged = page({ moderationStatus: 'FLAGGED' });
    const pending = page();
    expect(selectRetryablePages([done, flagged, pending])).toEqual([pending]);
  });
});
