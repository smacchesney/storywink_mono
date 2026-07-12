import { describe, it, expect } from 'vitest';
import {
  decideOrderTransition,
  extractTrackingUrl,
  OPEN_ORDER_STATUSES,
  LULU_POLL_INTERVAL_MS,
  LULU_POLL_MAX_AGE_DAYS,
  pollCutoffDate,
} from './lulu-status-poll.helpers.js';

describe('decideOrderTransition', () => {
  it('advances SUBMITTED_TO_LULU to IN_PRODUCTION', () => {
    expect(decideOrderTransition('SUBMITTED_TO_LULU', 'IN_PRODUCTION')).toEqual({
      kind: 'advance',
      nextStatus: 'IN_PRODUCTION',
    });
  });

  it('advances SUBMITTED_TO_LULU straight to SHIPPED when production was missed between sweeps', () => {
    expect(decideOrderTransition('SUBMITTED_TO_LULU', 'SHIPPED')).toEqual({
      kind: 'advance',
      nextStatus: 'SHIPPED',
    });
  });

  it('advances IN_PRODUCTION to SHIPPED', () => {
    expect(decideOrderTransition('IN_PRODUCTION', 'SHIPPED')).toEqual({
      kind: 'advance',
      nextStatus: 'SHIPPED',
    });
  });

  it('maps REJECTED to FAILED from any open status', () => {
    for (const current of OPEN_ORDER_STATUSES) {
      expect(decideOrderTransition(current, 'REJECTED')).toEqual({
        kind: 'advance',
        nextStatus: 'FAILED',
      });
    }
  });

  it('maps CANCELED (both spellings) to CANCELLED', () => {
    expect(decideOrderTransition('IN_PRODUCTION', 'CANCELED')).toEqual({
      kind: 'advance',
      nextStatus: 'CANCELLED',
    });
    expect(decideOrderTransition('IN_PRODUCTION', 'CANCELLED')).toEqual({
      kind: 'advance',
      nextStatus: 'CANCELLED',
    });
  });

  it('does nothing when Lulu reports the same stage again', () => {
    expect(decideOrderTransition('IN_PRODUCTION', 'IN_PRODUCTION')).toEqual({ kind: 'noop' });
  });

  it('never moves an order backwards (forward-only)', () => {
    // A stale Lulu response claiming pre-production must not demote the order.
    expect(decideOrderTransition('IN_PRODUCTION', 'PRODUCTION_READY')).toEqual({ kind: 'noop' });
    // Even a hypothetical SHIPPED order polled by mistake stays SHIPPED.
    expect(decideOrderTransition('SHIPPED', 'IN_PRODUCTION')).toEqual({ kind: 'noop' });
  });

  it('treats known pre-production Lulu states as no-ops', () => {
    for (const lulu of [
      'CREATED',
      'UNPAID',
      'PAYMENT_IN_PROGRESS',
      'PRODUCTION_DELAYED',
      'PRODUCTION_READY',
    ]) {
      expect(decideOrderTransition('SUBMITTED_TO_LULU', lulu)).toEqual({ kind: 'noop' });
    }
  });

  it('flags unknown Lulu statuses instead of guessing', () => {
    expect(decideOrderTransition('SUBMITTED_TO_LULU', 'SOME_NEW_STATUS')).toEqual({
      kind: 'unknown',
    });
    expect(decideOrderTransition('SUBMITTED_TO_LULU', '')).toEqual({ kind: 'unknown' });
    expect(decideOrderTransition('SUBMITTED_TO_LULU', undefined)).toEqual({ kind: 'unknown' });
    expect(decideOrderTransition('SUBMITTED_TO_LULU', null)).toEqual({ kind: 'unknown' });
  });

  it('normalizes casing and whitespace from the API', () => {
    expect(decideOrderTransition('SUBMITTED_TO_LULU', ' shipped ')).toEqual({
      kind: 'advance',
      nextStatus: 'SHIPPED',
    });
  });

  it('leaves orders in states the poller does not own untouched', () => {
    expect(decideOrderTransition('PENDING_PAYMENT', 'SHIPPED')).toEqual({ kind: 'noop' });
    expect(decideOrderTransition('DELIVERED', 'SHIPPED')).toEqual({ kind: 'noop' });
  });
});

describe('extractTrackingUrl', () => {
  it('returns the first usable tracking URL', () => {
    expect(
      extractTrackingUrl([
        { tracking_urls: [] },
        { tracking_urls: ['https://track.example/abc', 'https://track.example/def'] },
      ]),
    ).toBe('https://track.example/abc');
  });

  it('skips blank entries', () => {
    expect(extractTrackingUrl([{ tracking_urls: ['', '  ', 'https://track.example/x'] }])).toBe(
      'https://track.example/x',
    );
  });

  it('returns null when there is nothing to link', () => {
    expect(extractTrackingUrl(undefined)).toBeNull();
    expect(extractTrackingUrl([])).toBeNull();
    expect(extractTrackingUrl([{ tracking_urls: null }, {}])).toBeNull();
  });
});

describe('poll cadence', () => {
  it('runs every 6 hours', () => {
    expect(LULU_POLL_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });
});

describe('pollCutoffDate', () => {
  it('cuts off at maxAgeDays before now', () => {
    const now = new Date('2026-07-06T12:00:00Z');
    expect(pollCutoffDate(now, 90).toISOString()).toBe('2026-04-07T12:00:00.000Z');
  });

  it('defaults to LULU_POLL_MAX_AGE_DAYS', () => {
    const now = new Date('2026-07-06T12:00:00Z');
    const cutoff = pollCutoffDate(now);
    expect(now.getTime() - cutoff.getTime()).toBe(LULU_POLL_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  });
});
