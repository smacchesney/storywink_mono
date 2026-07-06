import { describe, it, expect } from 'vitest';
import {
  resolveDraftRetentionDays,
  DEFAULT_DRAFT_RETENTION_DAYS,
  isCleanupEnforced,
  summarizeDeletionResponse,
  addCounts,
} from './asset-cleanup.helpers.js';

describe('resolveDraftRetentionDays', () => {
  it('defaults to 90 when unset or blank', () => {
    expect(resolveDraftRetentionDays(undefined)).toBe(DEFAULT_DRAFT_RETENTION_DAYS);
    expect(resolveDraftRetentionDays('')).toBe(DEFAULT_DRAFT_RETENTION_DAYS);
    expect(resolveDraftRetentionDays('   ')).toBe(DEFAULT_DRAFT_RETENTION_DAYS);
  });

  it('accepts positive integers', () => {
    expect(resolveDraftRetentionDays('30')).toBe(30);
    expect(resolveDraftRetentionDays('365')).toBe(365);
  });

  it('falls back on zero, negatives, fractions, and garbage', () => {
    expect(resolveDraftRetentionDays('0')).toBe(DEFAULT_DRAFT_RETENTION_DAYS);
    expect(resolveDraftRetentionDays('-7')).toBe(DEFAULT_DRAFT_RETENTION_DAYS);
    expect(resolveDraftRetentionDays('7.5')).toBe(DEFAULT_DRAFT_RETENTION_DAYS);
    expect(resolveDraftRetentionDays('ninety')).toBe(DEFAULT_DRAFT_RETENTION_DAYS);
  });
});

describe('isCleanupEnforced', () => {
  it('is off by default (dry-run)', () => {
    expect(isCleanupEnforced(undefined)).toBe(false);
    expect(isCleanupEnforced('')).toBe(false);
    expect(isCleanupEnforced('false')).toBe(false);
    expect(isCleanupEnforced('no')).toBe(false);
    expect(isCleanupEnforced('0')).toBe(false);
  });

  it('turns on only for explicit true/1 (case/space tolerant)', () => {
    expect(isCleanupEnforced('true')).toBe(true);
    expect(isCleanupEnforced('TRUE')).toBe(true);
    expect(isCleanupEnforced(' true ')).toBe(true);
    expect(isCleanupEnforced('1')).toBe(true);
  });
});

describe('summarizeDeletionResponse', () => {
  it('counts deleted, not_found, and unknown statuses', () => {
    const counts = summarizeDeletionResponse({
      deleted: { a: 'deleted', b: 'deleted', c: 'not_found', d: 'blocked' },
    });
    expect(counts).toEqual({ deleted: 2, notFound: 1, other: 1 });
  });

  it('is defensive about malformed responses', () => {
    expect(summarizeDeletionResponse(undefined)).toEqual({ deleted: 0, notFound: 0, other: 0 });
    expect(summarizeDeletionResponse(null)).toEqual({ deleted: 0, notFound: 0, other: 0 });
    expect(summarizeDeletionResponse({})).toEqual({ deleted: 0, notFound: 0, other: 0 });
    expect(summarizeDeletionResponse({ deleted: 'nope' })).toEqual({
      deleted: 0,
      notFound: 0,
      other: 0,
    });
  });
});

describe('addCounts', () => {
  it('sums componentwise', () => {
    expect(
      addCounts({ deleted: 1, notFound: 2, other: 0 }, { deleted: 3, notFound: 0, other: 4 }),
    ).toEqual({ deleted: 4, notFound: 2, other: 4 });
  });
});
