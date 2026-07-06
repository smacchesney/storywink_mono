/**
 * Pure configuration and response-shaping logic for the asset-cleanup worker.
 * Kept free of prisma/bullmq/cloudinary imports so it can be unit-tested
 * without a database, Redis, or network (same pattern as book-reaper.helpers).
 */

/** Job name of the repeatable draft-retention sweep on the asset-cleanup queue. */
export const DRAFT_SWEEP_JOB_NAME = 'draft-retention-sweep';

/** How often the draft-retention sweep runs. */
export const DRAFT_SWEEP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // weekly

/** Max DRAFT candidates handled per sweep; the next sweep picks up the rest. */
export const DRAFT_SWEEP_BATCH_SIZE = 100;

/** Cloudinary Admin API accepts up to 100 public ids per delete_resources call. */
export const CLOUDINARY_DELETE_CHUNK_SIZE = 100;

/**
 * Safety cap on delete_resources_by_prefix pagination (each call removes up
 * to 1000 resources and reports `partial: true` while more remain).
 */
export const MAX_PREFIX_DELETE_ITERATIONS = 50;

/** Default draft retention window when DRAFT_RETENTION_DAYS is unset/invalid. */
export const DEFAULT_DRAFT_RETENTION_DAYS = 90;

/**
 * How old an 'asset_cleanup_pending' record must be before the reconcile pass
 * treats its deletion job as lost and re-enqueues it. Generous relative to the
 * deletion job's own retry backoff, so normally-retried jobs finish (and write
 * their 'assets_deleted'/'assets_delete_dry_run' event) well inside it.
 */
export const PENDING_RECONCILE_GRACE_MS = 60 * 60 * 1000;

/** Max pending records examined per reconcile pass. */
export const PENDING_RECONCILE_BATCH_SIZE = 200;

/**
 * DRAFT_RETENTION_DAYS env parsing: positive integers only, everything else
 * falls back to the 90-day default so a typo can never make the sweep hungrier.
 */
export function resolveDraftRetentionDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_DRAFT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_DRAFT_RETENTION_DAYS;
  return parsed;
}

/**
 * ASSET_CLEANUP_ENFORCE gate: everything destructive (Cloudinary deletion AND
 * the sweep's book-row deletion) is DRY-RUN unless this is explicitly "true"
 * or "1". Default off.
 */
export function isCleanupEnforced(raw: string | undefined): boolean {
  const normalized = (raw ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

/** Per-id statuses reported by Cloudinary's delete_resources response. */
export interface DeletionCounts {
  deleted: number;
  notFound: number;
  other: number;
}

/**
 * Folds a Cloudinary `{ deleted: { publicId: status } }` response into counts.
 * "not_found" is an expected outcome (retries, double-deletes) — never an
 * error. Unknown statuses are counted so the logs surface API drift.
 */
export function summarizeDeletionResponse(response: unknown): DeletionCounts {
  const counts: DeletionCounts = { deleted: 0, notFound: 0, other: 0 };
  const deletedMap =
    response && typeof response === 'object'
      ? (response as { deleted?: unknown }).deleted
      : undefined;
  if (!deletedMap || typeof deletedMap !== 'object') return counts;

  for (const status of Object.values(deletedMap as Record<string, unknown>)) {
    if (status === 'deleted') counts.deleted += 1;
    else if (status === 'not_found') counts.notFound += 1;
    else counts.other += 1;
  }
  return counts;
}

export function addCounts(a: DeletionCounts, b: DeletionCounts): DeletionCounts {
  return {
    deleted: a.deleted + b.deleted,
    notFound: a.notFound + b.notFound,
    other: a.other + b.other,
  };
}
