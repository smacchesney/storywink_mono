import { describe, it, expect } from 'vitest';
import { peekOutcome } from './peek-plan';

describe('peekOutcome — paint-now', () => {
  it('delayed job → promote', () => {
    expect(peekOutcome('paint-now', 'delayed', 'STORY_READY')).toEqual({ kind: 'promote' });
  });
  it('already waiting/active → acknowledge, never double-start', () => {
    expect(peekOutcome('paint-now', 'waiting', 'STORY_READY')).toEqual({
      kind: 'already-running',
    });
    expect(peekOutcome('paint-now', 'active', 'ILLUSTRATING')).toEqual({
      kind: 'already-running',
    });
  });
  it('no job + STORY_READY → start fresh (flag-off worker or lost enqueue)', () => {
    expect(peekOutcome('paint-now', null, 'STORY_READY')).toEqual({ kind: 'start-fresh' });
  });
  it('no job + any other status → not waiting', () => {
    expect(peekOutcome('paint-now', null, 'COMPLETED')).toEqual({ kind: 'not-waiting' });
    expect(peekOutcome('paint-now', 'completed', 'ILLUSTRATING')).toEqual({
      kind: 'not-waiting',
    });
  });
});

describe('peekOutcome — rearm', () => {
  it('delayed job → rearm with a fresh window', () => {
    expect(peekOutcome('rearm', 'delayed', 'STORY_READY')).toEqual({ kind: 'rearm' });
  });
  it('painting already under way → refuse', () => {
    expect(peekOutcome('rearm', 'waiting', 'STORY_READY')).toEqual({ kind: 'already-painting' });
    expect(peekOutcome('rearm', 'active', 'ILLUSTRATING')).toEqual({ kind: 'already-painting' });
    expect(peekOutcome('rearm', null, 'ILLUSTRATING')).toEqual({ kind: 'already-painting' });
  });
  it('nothing armed on a parked book → noop (manual review path)', () => {
    expect(peekOutcome('rearm', null, 'STORY_READY')).toEqual({ kind: 'noop' });
  });
});
