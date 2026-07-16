/**
 * Pure decision logic for the print-fulfillment worker. Kept free of
 * prisma/bullmq imports so it can be unit-tested without a database or Redis.
 *
 * The invariant these decisions protect: a PrintOrder must never be submitted
 * to Lulu twice. Submission is a paid, non-idempotent external call — Lulu
 * records our external_id but does not dedupe on it.
 */

export type FulfillmentDecision =
  | { kind: 'proceed' }
  | { kind: 'skip'; reason: string }
  | { kind: 'ambiguous-submission' };

export interface FulfillmentOrderState {
  status: string;
  luluPrintJobId: string | null;
  luluSubmissionAttemptedAt: Date | null;
}

/**
 * Decide whether a fulfillment run may do any work on this order.
 *
 * - A recorded Lulu id always means "done" — even if the poller later marked
 *   the order FAILED (Lulu rejected it), a reprint is a human decision.
 * - A submission claim (luluSubmissionAttemptedAt) without a Lulu id means a
 *   previous run died inside the submission window; whether Lulu accepted the
 *   job is unknowable from our side, so we fail closed and never resubmit.
 * - Only PAYMENT_COMPLETED and claim-free FAILED (a BullMQ retry of a
 *   pre-submission failure such as PDF generation) may proceed. Every other
 *   status — including ones this code has never heard of — skips.
 */
export function decideFulfillmentAction(order: FulfillmentOrderState): FulfillmentDecision {
  if (order.luluPrintJobId) {
    return { kind: 'skip', reason: `already submitted (Lulu job ${order.luluPrintJobId})` };
  }

  if (order.luluSubmissionAttemptedAt) {
    return { kind: 'ambiguous-submission' };
  }

  if (order.status === 'PAYMENT_COMPLETED' || order.status === 'FAILED') {
    return { kind: 'proceed' };
  }

  return { kind: 'skip', reason: `status ${order.status} is not fulfillable` };
}

export type LuluSubmissionErrorKind = 'not-created' | 'unknown-outcome';

/**
 * Classify a failed createPrintJob call by HTTP status. A 4xx means Lulu
 * received and rejected the request — no print job exists, so the submission
 * claim can be cleared and the job retried. Anything else (5xx, no response)
 * leaves Lulu's state unknowable: fail closed.
 */
export function classifyLuluSubmissionError(
  httpStatus: number | undefined,
): LuluSubmissionErrorKind {
  if (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500) {
    return 'not-created';
  }
  return 'unknown-outcome';
}
