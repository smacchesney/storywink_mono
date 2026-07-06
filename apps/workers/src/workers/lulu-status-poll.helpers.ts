/**
 * Pure decision logic for the Lulu order-status poller. Kept free of
 * prisma/bullmq imports so it can be unit-tested without a database or Redis.
 */

/** How often the repeatable Lulu status sweep runs. */
export const LULU_POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Max orders polled per sweep; the next sweep picks up the rest. */
export const LULU_POLL_BATCH_SIZE = 50;

/** Orders older than this stop being polled — pre-launch test orders point at
 * Lulu jobs that no longer exist and would otherwise 404 every sweep forever.
 * Env-tunable so a genuinely slow order can be re-included if it ever happens. */
export const LULU_POLL_MAX_AGE_DAYS = Number(process.env.LULU_POLL_MAX_AGE_DAYS ?? 90);

/** Cutoff date for pollable orders, computed per sweep. */
export function pollCutoffDate(now: Date, maxAgeDays: number = LULU_POLL_MAX_AGE_DAYS): Date {
  return new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000);
}

/** The only PrintOrder statuses worth polling — everything else is terminal
 * (or pre-submission, where there is no Lulu job to ask about). */
export const OPEN_ORDER_STATUSES = ['SUBMITTED_TO_LULU', 'IN_PRODUCTION'] as const;
export type OpenOrderStatus = (typeof OPEN_ORDER_STATUSES)[number];

/** PrintOrder statuses the poller can read or write. */
export type PolledOrderStatus =
  | 'SUBMITTED_TO_LULU'
  | 'IN_PRODUCTION'
  | 'SHIPPED'
  | 'FAILED'
  | 'CANCELLED';

export type AdvanceStatus = Exclude<PolledOrderStatus, 'SUBMITTED_TO_LULU'>;

export type OrderTransition =
  | { kind: 'advance'; nextStatus: AdvanceStatus }
  | { kind: 'noop' }
  | { kind: 'unknown' };

/**
 * Lulu print-job status names → PrintOrder statuses. null = a known Lulu
 * state that maps to no transition (still pre-production from the parent's
 * point of view). Anything not listed here is treated as unknown: logged and
 * skipped, never guessed at.
 */
const LULU_STATUS_MAP: Record<string, AdvanceStatus | null> = {
  CREATED: null,
  UNPAID: null,
  PAYMENT_IN_PROGRESS: null,
  PRODUCTION_DELAYED: null,
  PRODUCTION_READY: null,
  IN_PRODUCTION: 'IN_PRODUCTION',
  SHIPPED: 'SHIPPED',
  REJECTED: 'FAILED',
  // Lulu spells it with one L; accept both to survive API drift.
  CANCELED: 'CANCELLED',
  CANCELLED: 'CANCELLED',
};

/**
 * Forward-only ordering: an order may only move to a strictly higher rank.
 * FAILED/CANCELLED are terminal and rank above SHIPPED so a sideways order
 * can be marked from any open state, but a SHIPPED order (not polled anyway)
 * could never be dragged backwards by a stale Lulu response.
 */
const STATUS_RANK: Record<PolledOrderStatus, number> = {
  SUBMITTED_TO_LULU: 0,
  IN_PRODUCTION: 1,
  SHIPPED: 2,
  FAILED: 3,
  CANCELLED: 3,
};

/**
 * Decide what (if anything) to do with an order given the status Lulu just
 * reported. Forward-only and defensive: unknown Lulu statuses and unknown
 * current statuses both produce no write.
 */
export function decideOrderTransition(
  currentStatus: string,
  luluStatusName: string | null | undefined,
): OrderTransition {
  const normalized = (luluStatusName ?? '').trim().toUpperCase();
  if (!(normalized in LULU_STATUS_MAP)) {
    return { kind: 'unknown' };
  }

  const mapped = LULU_STATUS_MAP[normalized];
  if (mapped === null) {
    return { kind: 'noop' };
  }

  const currentRank = STATUS_RANK[currentStatus as PolledOrderStatus];
  if (currentRank === undefined) {
    // An order in a state we never poll (or don't understand) — leave it be.
    return { kind: 'noop' };
  }

  if (STATUS_RANK[mapped] <= currentRank) {
    return { kind: 'noop' };
  }

  return { kind: 'advance', nextStatus: mapped };
}

export interface TrackableLineItem {
  tracking_urls?: string[] | null;
}

/**
 * First usable tracking URL across the print job's line items. Storywink
 * orders have exactly one line item, but the shape is an array.
 */
export function extractTrackingUrl(
  lineItems: ReadonlyArray<TrackableLineItem> | null | undefined,
): string | null {
  for (const item of lineItems ?? []) {
    for (const url of item.tracking_urls ?? []) {
      if (typeof url === 'string' && url.trim().length > 0) {
        return url;
      }
    }
  }
  return null;
}
