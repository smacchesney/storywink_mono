import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STORY_PEEK_GRACE_MS,
  peekExtractJobId,
  resolveAutoChainPlan,
  shouldRunAfterClaim,
  storyPeekGraceMs,
} from './peek.js';

describe('storyPeekGraceMs', () => {
  it('unset/blank/invalid/zero → 0 (peek off, legacy chain)', () => {
    expect(storyPeekGraceMs({})).toBe(0);
    expect(storyPeekGraceMs({ STORY_PEEK_GRACE_MS: '' })).toBe(0);
    expect(storyPeekGraceMs({ STORY_PEEK_GRACE_MS: 'soon' })).toBe(0);
    expect(storyPeekGraceMs({ STORY_PEEK_GRACE_MS: '0' })).toBe(0);
    expect(storyPeekGraceMs({ STORY_PEEK_GRACE_MS: '-5' })).toBe(0);
  });
  it('parses a positive integer', () => {
    expect(storyPeekGraceMs({ STORY_PEEK_GRACE_MS: '180000' })).toBe(DEFAULT_STORY_PEEK_GRACE_MS);
    expect(storyPeekGraceMs({ STORY_PEEK_GRACE_MS: '45000.9' })).toBe(45000);
  });
});

describe('resolveAutoChainPlan', () => {
  const base = { autoIllustrate: true, bookType: 'PHOTO_STORY', graceMs: 180000 };
  it('no auto-illustrate → none', () => {
    expect(resolveAutoChainPlan({ ...base, autoIllustrate: false }).mode).toBe('none');
  });
  it('avatar books never peek', () => {
    expect(resolveAutoChainPlan({ ...base, bookType: 'AVATAR_STORY' }).mode).toBe('immediate');
  });
  it('grace 0 → immediate (legacy)', () => {
    expect(resolveAutoChainPlan({ ...base, graceMs: 0 }).mode).toBe('immediate');
  });
  it('photo book + grace → delayed with that delay', () => {
    expect(resolveAutoChainPlan(base)).toEqual({ mode: 'delayed', delayMs: 180000 });
  });
});

describe('claim + job id', () => {
  it('deterministic job id', () => {
    expect(peekExtractJobId('b1')).toBe('peek-extract-b1');
  });
  it('runs when this job claimed, or when someone else already set ILLUSTRATING', () => {
    expect(shouldRunAfterClaim(1, 'ILLUSTRATING')).toBe(true);
    expect(shouldRunAfterClaim(0, 'ILLUSTRATING')).toBe(true);
    expect(shouldRunAfterClaim(0, 'STORY_READY')).toBe(false);
    expect(shouldRunAfterClaim(0, 'COMPLETED')).toBe(false);
  });
});
