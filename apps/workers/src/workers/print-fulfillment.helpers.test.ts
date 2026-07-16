import { describe, it, expect } from 'vitest';
import {
  decideFulfillmentAction,
  classifyLuluSubmissionError,
} from './print-fulfillment.helpers.js';

describe('decideFulfillmentAction', () => {
  const fresh = {
    status: 'PAYMENT_COMPLETED',
    luluPrintJobId: null,
    luluSubmissionAttemptedAt: null,
  };

  it('proceeds for a paid order that has never touched Lulu', () => {
    expect(decideFulfillmentAction(fresh)).toEqual({ kind: 'proceed' });
  });

  it('proceeds for a FAILED order with no submission claim (BullMQ retry of a pre-submission failure)', () => {
    expect(decideFulfillmentAction({ ...fresh, status: 'FAILED' })).toEqual({ kind: 'proceed' });
  });

  it('skips when a Lulu print job id is already recorded', () => {
    const decision = decideFulfillmentAction({
      status: 'SUBMITTED_TO_LULU',
      luluPrintJobId: '12345',
      luluSubmissionAttemptedAt: new Date('2026-07-16T00:00:00Z'),
    });
    expect(decision.kind).toBe('skip');
  });

  it('skips on a recorded Lulu id even when the status says FAILED (poller may mark rejects)', () => {
    const decision = decideFulfillmentAction({
      status: 'FAILED',
      luluPrintJobId: '12345',
      luluSubmissionAttemptedAt: new Date('2026-07-16T00:00:00Z'),
    });
    expect(decision.kind).toBe('skip');
  });

  it('fails closed when a submission was claimed but no Lulu id was recorded', () => {
    // The crash window: createPrintJob may or may not have gone through.
    // Resubmitting here is the double-paid-order bug — never proceed.
    expect(
      decideFulfillmentAction({
        ...fresh,
        luluSubmissionAttemptedAt: new Date('2026-07-16T00:00:00Z'),
      }),
    ).toEqual({ kind: 'ambiguous-submission' });
  });

  it('fails closed on claimed-but-idless even after the order was marked FAILED', () => {
    expect(
      decideFulfillmentAction({
        status: 'FAILED',
        luluPrintJobId: null,
        luluSubmissionAttemptedAt: new Date('2026-07-16T00:00:00Z'),
      }),
    ).toEqual({ kind: 'ambiguous-submission' });
  });

  it('skips cancelled orders instead of falling through to submission', () => {
    const decision = decideFulfillmentAction({ ...fresh, status: 'CANCELLED' });
    expect(decision.kind).toBe('skip');
  });

  it('skips unpaid orders', () => {
    const decision = decideFulfillmentAction({ ...fresh, status: 'PENDING_PAYMENT' });
    expect(decision.kind).toBe('skip');
  });

  it('skips orders already in or past production', () => {
    for (const status of ['IN_PRODUCTION', 'SHIPPED', 'DELIVERED']) {
      expect(decideFulfillmentAction({ ...fresh, status }).kind).toBe('skip');
    }
  });

  it('skips statuses it does not recognize rather than guessing', () => {
    expect(decideFulfillmentAction({ ...fresh, status: 'SOME_NEW_STATUS' }).kind).toBe('skip');
  });
});

describe('classifyLuluSubmissionError', () => {
  it('treats 4xx responses as definitely-not-created (safe to clear the claim and retry)', () => {
    for (const status of [400, 401, 404, 422, 429]) {
      expect(classifyLuluSubmissionError(status)).toBe('not-created');
    }
  });

  it('treats 5xx responses as unknown outcome (fail closed)', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyLuluSubmissionError(status)).toBe('unknown-outcome');
    }
  });

  it('treats missing status (network failure, timeout) as unknown outcome', () => {
    expect(classifyLuluSubmissionError(undefined)).toBe('unknown-outcome');
  });

  it('treats non-4xx oddities as unknown outcome', () => {
    for (const status of [0, 302]) {
      expect(classifyLuluSubmissionError(status)).toBe('unknown-outcome');
    }
  });
});
