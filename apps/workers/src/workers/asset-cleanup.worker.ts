import { Job, Queue } from 'bullmq';
import { v2 as cloudinary } from 'cloudinary';
import prisma from '../database/index.js';
import {
  QUEUE_NAMES,
  AVATAR_DETECTION_EVENT,
  AVATAR_DETECTION_CONSUMED_EVENT,
  DETECTION_TTL_MS,
  DETECTION_SWEEP_GRACE_MS,
  DETECTION_REAP_HORIZON_MS,
} from '@storywink/shared/constants';
import { createBullMQConnection } from '@storywink/shared/redis';
import {
  trackEvent,
  assetCleanupJobSchema,
  type AssetCleanupJobPayload,
  collectBookGeneratedPublicIds,
  bookGeneratedFolderPrefix,
  isSafeCloudinaryPrefix,
  excludeSharedAssetIds,
  deletableStagedAssetIds,
  isDraftSweepCandidate,
  chunkPublicIds,
  ASSET_CLEANUP_PENDING_EVENT,
} from '@storywink/shared';
import pino from 'pino';
import {
  DRAFT_SWEEP_JOB_NAME,
  DRAFT_SWEEP_BATCH_SIZE,
  CLOUDINARY_DELETE_CHUNK_SIZE,
  MAX_PREFIX_DELETE_ITERATIONS,
  PENDING_RECONCILE_GRACE_MS,
  PENDING_RECONCILE_BATCH_SIZE,
  resolveDraftRetentionDays,
  isCleanupEnforced,
  summarizeDeletionResponse,
  addCounts,
  type DeletionCounts,
} from './asset-cleanup.helpers.js';
import { computeLastActivity } from './book-reaper.helpers.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Lazy queue singleton (reaper pattern): the sweep enqueues deletion jobs
// back onto this same queue so expired drafts ride the exact retry path
// user-initiated deletions do.
let assetCleanupQueue: Queue | null = null;
function getAssetCleanupQueue(): Queue {
  if (!assetCleanupQueue) {
    assetCleanupQueue = new Queue(QUEUE_NAMES.ASSET_CLEANUP, {
      connection: createBullMQConnection(),
    });
  }
  return assetCleanupQueue;
}

function configureCloudinary(): void {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/**
 * Deletes explicit public ids in Admin-API-sized chunks. Individual
 * "not_found" results are expected (job retries, double deletes) and never
 * fail the job; a thrown API error (network, auth, 420 rate limit) propagates
 * so BullMQ retries with backoff. Chunks already deleted before a retry
 * simply report not_found the second time — the operation is idempotent.
 */
async function deletePublicIds(publicIds: string[]): Promise<DeletionCounts> {
  let counts: DeletionCounts = { deleted: 0, notFound: 0, other: 0 };
  for (const chunk of chunkPublicIds(publicIds, CLOUDINARY_DELETE_CHUNK_SIZE)) {
    const response = await cloudinary.api.delete_resources(chunk, {
      resource_type: 'image',
      type: 'upload',
      invalidate: true,
    });
    counts = addCounts(counts, summarizeDeletionResponse(response));
  }
  return counts;
}

/**
 * Purges a scoped folder (storywink/<bookId>/ or user_<id>/uploads/). This is
 * what catches binaries no DB row points at anymore: renders superseded by QC
 * re-illustration rounds and uploads that raced the deletion. Each call
 * removes up to 1000 resources; `partial: true` means more remain.
 */
async function deleteByPrefix(prefix: string): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < MAX_PREFIX_DELETE_ITERATIONS; i += 1) {
    const response = (await cloudinary.api.delete_resources_by_prefix(prefix, {
      resource_type: 'image',
      type: 'upload',
      invalidate: true,
    })) as { deleted?: Record<string, string>; partial?: boolean };
    deleted += summarizeDeletionResponse(response).deleted;
    if (!response.partial) return deleted;
  }
  logger.warn(
    { prefix, iterations: MAX_PREFIX_DELETE_ITERATIONS, deleted },
    'Asset cleanup: prefix delete still partial after max iterations — job retry will resume',
  );
  throw new Error(
    `Prefix delete incomplete for ${prefix} after ${MAX_PREFIX_DELETE_ITERATIONS} iterations`,
  );
}

/** One enqueued deletion job: {publicIds, prefixes?, reason, userId?, bookId?}. */
async function runAssetDeletion(job: Job) {
  const parsed = assetCleanupJobSchema.safeParse(job.data);
  if (!parsed.success) {
    // A malformed payload cannot heal on retry — log loudly and stop.
    logger.error(
      { jobId: job.id, issues: parsed.error.issues },
      'Asset cleanup: invalid job payload, skipping',
    );
    return { invalidPayload: true };
  }

  const { publicIds, reason, userId, bookId } = parsed.data;
  // Unsafe prefixes are dropped, never "fixed": a bare "storywink/" would
  // wipe every book in the account.
  const prefixes = (parsed.data.prefixes ?? []).filter((p) => {
    if (isSafeCloudinaryPrefix(p)) return true;
    logger.error({ jobId: job.id, prefix: p }, 'Asset cleanup: refusing unsafe prefix');
    return false;
  });

  if (publicIds.length === 0 && prefixes.length === 0) {
    logger.info({ jobId: job.id, reason }, 'Asset cleanup: nothing to delete');
    return { deleted: 0, notFound: 0, prefixes: 0, dryRun: false };
  }

  const enforce = isCleanupEnforced(process.env.ASSET_CLEANUP_ENFORCE);

  if (!enforce) {
    // DRY-RUN (default): the full target list goes to the logs so the owner
    // can audit exactly what WOULD be deleted before flipping the flag.
    logger.info(
      { jobId: job.id, reason, userId, bookId, count: publicIds.length, publicIds, prefixes },
      'Asset cleanup DRY-RUN: would delete these Cloudinary resources (set ASSET_CLEANUP_ENFORCE=true to enforce)',
    );
    await trackEvent(
      prisma,
      {
        name: 'assets_delete_dry_run',
        userId,
        bookId,
        props: { count: publicIds.length, prefixCount: prefixes.length, reason },
      },
      logger,
    );
    return { deleted: 0, notFound: 0, prefixes: prefixes.length, dryRun: true };
  }

  configureCloudinary();

  let counts = await deletePublicIds(publicIds);
  for (const prefix of prefixes) {
    counts = addCounts(counts, { deleted: await deleteByPrefix(prefix), notFound: 0, other: 0 });
  }

  logger.info(
    { jobId: job.id, reason, userId, bookId, ...counts, prefixCount: prefixes.length },
    'Asset cleanup: Cloudinary deletion finished',
  );
  await trackEvent(
    prisma,
    {
      name: 'assets_deleted',
      userId,
      bookId,
      props: { count: counts.deleted, notFound: counts.notFound, reason },
    },
    logger,
  );

  return { ...counts, prefixes: prefixes.length, dryRun: false };
}

type SweepCandidate = {
  id: string;
  userId: string;
  status: string;
  updatedAt: Date;
  coverAssetId: string | null;
  coverImageUrl: string | null;
  characterReferences: unknown;
  pages: Array<{ assetId: string | null; generatedImageUrl: string | null; updatedAt: Date }>;
};

/**
 * Collects everything a doomed book owns in Cloudinary: its generated
 * content (pages/cover/sheets + the book folder prefix) and the original
 * photos it references — MINUS any asset another book also references
 * (the create route lets two books share one upload).
 */
async function collectBookCleanupTargets(book: SweepCandidate) {
  const candidateAssetIds = excludeSharedAssetIds(
    [...book.pages.map((p) => p.assetId), book.coverAssetId],
    [],
  );

  const [externalPages, externalCovers] = await Promise.all([
    prisma.page.findMany({
      where: { assetId: { in: candidateAssetIds }, bookId: { not: book.id } },
      select: { assetId: true },
    }),
    prisma.book.findMany({
      where: { coverAssetId: { in: candidateAssetIds }, id: { not: book.id } },
      select: { coverAssetId: true },
    }),
  ]);

  const deletableAssetIds = excludeSharedAssetIds(candidateAssetIds, [
    ...externalPages.map((p) => p.assetId),
    ...externalCovers.map((b) => b.coverAssetId),
  ]);

  const deletableAssets = await prisma.asset.findMany({
    where: { id: { in: deletableAssetIds } },
    select: { publicId: true },
  });

  const publicIds = [
    ...new Set([...deletableAssets.map((a) => a.publicId), ...collectBookGeneratedPublicIds(book)]),
  ];

  return { publicIds, prefixes: [bookGeneratedFolderPrefix(book.id)] };
}

/**
 * Reconcile pass for the delete→enqueue gap: an 'asset_cleanup_pending'
 * AppEvent is written (throwing, pre-delete) by every book-deletion path with
 * the full Cloudinary target list in props. If the deletion job's terminal
 * event ('assets_deleted' / 'assets_delete_dry_run') never appears — enqueue
 * failure, crash, Redis eviction — this pass re-enqueues from the stored
 * props. Safe because runAssetDeletion is idempotent (not_found tolerated,
 * prefix deletes resumable). A pending record whose Book row still exists is
 * stale (the delete itself never committed) and is removed instead.
 */
async function reconcilePendingCleanups(now: Date): Promise<number> {
  let requeued = 0;
  const graceCutoff = new Date(now.getTime() - PENDING_RECONCILE_GRACE_MS);

  const pendingEvents = await prisma.appEvent.findMany({
    where: { name: ASSET_CLEANUP_PENDING_EVENT, createdAt: { lt: graceCutoff } },
    orderBy: { createdAt: 'asc' },
    take: PENDING_RECONCILE_BATCH_SIZE,
  });

  for (const event of pendingEvents) {
    try {
      if (!event.bookId) continue;

      const satisfied = await prisma.appEvent.count({
        where: {
          bookId: event.bookId,
          name: { in: ['assets_deleted', 'assets_delete_dry_run'] },
        },
      });
      if (satisfied > 0) continue;

      // Book row still present: the delete never committed (crash between the
      // pending write and the delete, or a conditional delete that matched
      // nothing). Deleting these assets would strip a LIVE book — drop the
      // stale marker instead; a future delete/sweep writes a fresh one.
      const bookStillExists = await prisma.book.count({ where: { id: event.bookId } });
      if (bookStillExists > 0) {
        await prisma.appEvent.deleteMany({
          where: { id: event.id, name: ASSET_CLEANUP_PENDING_EVENT },
        });
        logger.warn(
          { bookId: event.bookId, eventId: event.id },
          'Asset cleanup reconcile: pending record for a still-existing book — removed stale marker',
        );
        continue;
      }

      const props = (event.props ?? {}) as {
        publicIds?: string[];
        prefixes?: string[];
        reason?: string;
      };
      const publicIds = Array.isArray(props.publicIds) ? props.publicIds : [];
      const prefixes = Array.isArray(props.prefixes) ? props.prefixes : [];
      if (publicIds.length === 0 && prefixes.length === 0) continue;
      const reason = props.reason === 'book_deleted' ? 'book_deleted' : 'draft_expired';

      await getAssetCleanupQueue().add(
        `cleanup-reconcile-${event.bookId}`,
        {
          publicIds,
          prefixes,
          reason,
          userId: event.userId ?? undefined,
          bookId: event.bookId,
        } satisfies AssetCleanupJobPayload,
        {
          // Deterministic id: repeated reconcile passes dedupe against the
          // original enqueue (and each other) while the job is still around.
          jobId:
            reason === 'book_deleted'
              ? `cleanup-book-${event.bookId}`
              : `cleanup-draft-${event.bookId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      );
      requeued += 1;
      logger.warn(
        { bookId: event.bookId, publicIdCount: publicIds.length, prefixes, reason },
        'Asset cleanup reconcile: re-enqueued lost deletion job from pending record',
      );
    } catch (error) {
      logger.error(
        {
          bookId: event.bookId,
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Asset cleanup reconcile: failed to process pending record',
      );
    }
  }

  return requeued;
}

const DETECTION_SWEEP_BATCH_SIZE = 200;

/**
 * Global backstop for the batch studio's retention promise. The web routes
 * strip subject PII at redemption/expiry and sweep the CALLING user's expired
 * rows on each detect — but a user who detects once and never returns leaves
 * AI-derived descriptions of children (and background strangers) in
 * AppEvent.props forever, plus staged photos attached to nothing. This pass
 * rides the same repeatable sweep as the draft reaper, in two phases:
 *
 * 1. PII STRIP (always, TTL+grace): full-PII rows become {assetIds}-only
 *    tombstones. The privacy promise never waits on the enforce flag.
 * 2. PHOTO REAP (only when ASSET_CLEANUP_ENFORCE, TTL+24h horizon):
 *    tombstones old enough that no open studio session can straddle them get
 *    their unattached photos destroyed and their rows deleted. In dry-run the
 *    tombstones are the durable record a later enforced pass reaps from —
 *    deleting rows while the jobs dry-run would strand the bytes forever.
 *
 * The reference guard (deletableStagedAssetIds — shared with the web reaper)
 * spares any photo a book page, cover, or avatar still points at; ids that
 * also appear in a NEWER detection row of the same user are spared for the
 * in-flight re-detect case (protection re-read as the last step before
 * destruction). Enqueue-before-delete, per the house pattern.
 */
async function sweepExpiredDetectionEvents(now: Date): Promise<number> {
  const assetIdsOf = (props: unknown): string[] => {
    const ids = (props as { assetIds?: unknown } | null)?.assetIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  };

  // Phase 1 — PII strip, ALWAYS (no enforcement gate: this is a DB update,
  // not byte destruction). Full-PII rows past TTL+grace become {assetIds}
  // tombstones, exactly like the batch route's consume/expiry strip.
  const stripCutoff = new Date(now.getTime() - DETECTION_TTL_MS - DETECTION_SWEEP_GRACE_MS);
  const piiRows = await prisma.appEvent.findMany({
    where: { name: AVATAR_DETECTION_EVENT, createdAt: { lt: stripCutoff } },
    orderBy: { createdAt: 'asc' },
    take: DETECTION_SWEEP_BATCH_SIZE,
    select: { id: true, props: true },
  });
  for (const row of piiRows) {
    // Conditional on the name so a concurrent batch consume never gets
    // double-written; props differ per row, hence the per-row update.
    await prisma.appEvent.updateMany({
      where: { id: row.id, name: AVATAR_DETECTION_EVENT },
      data: { name: AVATAR_DETECTION_CONSUMED_EVENT, props: { assetIds: assetIdsOf(row.props) } },
    });
  }
  if (piiRows.length > 0) {
    logger.info({ stripped: piiRows.length }, 'Detection sweep: PII stripped from expired rows');
  }

  // Phase 2 — photo reap + row deletion, ONLY when byte deletion is enforced.
  // In dry-run the tombstones (no subject PII, just opaque ids) are the
  // durable record an enforced pass later reaps from; deleting rows while the
  // enqueued jobs merely dry-run-log would strand the bytes forever.
  if (!isCleanupEnforced(process.env.ASSET_CLEANUP_ENFORCE)) {
    return piiRows.length;
  }

  // Reap horizon is deliberately much longer than the strip horizon: a
  // 410-recovery re-detect happens over the SAME staged photos an old
  // tombstone records, and this sweep cannot see an in-flight request the
  // way the detect route's own sweep can.
  const reapCutoff = new Date(now.getTime() - DETECTION_TTL_MS - DETECTION_REAP_HORIZON_MS);
  const expired = await prisma.appEvent.findMany({
    where: { name: AVATAR_DETECTION_CONSUMED_EVENT, createdAt: { lt: reapCutoff } },
    orderBy: { createdAt: 'asc' },
    take: DETECTION_SWEEP_BATCH_SIZE,
    select: { id: true, userId: true, props: true },
  });
  if (expired.length === 0) return piiRows.length;

  const byUser = new Map<string, string[]>();
  for (const event of expired) {
    if (!event.userId) continue;
    const list = byUser.get(event.userId) ?? [];
    list.push(...assetIdsOf(event.props));
    byUser.set(event.userId, list);
  }

  // A user whose photo reap fails keeps their rows for the next pass — but a
  // user with nothing to reap (legacy null props) still gets their rows
  // deleted, which is harmless row hygiene by this point.
  const failedUsers = new Set<string>();

  const newerRowsProtect = (userId: string) =>
    prisma.appEvent.findMany({
      where: {
        userId,
        name: { in: [AVATAR_DETECTION_EVENT, AVATAR_DETECTION_CONSUMED_EVENT] },
        createdAt: { gte: reapCutoff },
      },
      select: { props: true },
    });

  for (const [userId, candidateIds] of byUser) {
    try {
      const candidates = [...new Set(candidateIds)];
      if (candidates.length === 0) continue;
      const [pageRefs, coverRefs, avatarRefs] = await Promise.all([
        prisma.page.findMany({ where: { assetId: { in: candidates } }, select: { assetId: true } }),
        prisma.book.findMany({
          where: { coverAssetId: { in: candidates } },
          select: { coverAssetId: true },
        }),
        prisma.avatarPhoto.findMany({
          where: { assetId: { in: candidates } },
          select: { assetId: true },
        }),
      ]);
      // Re-read the protection set as the LAST thing before destruction: a
      // re-detect row written after an earlier read must still protect its
      // photos (the enqueue below is irreversible once the job runs).
      const liveRows = await newerRowsProtect(userId);
      const liveProtected = new Set(liveRows.flatMap((row) => assetIdsOf(row.props)));
      const deletable = deletableStagedAssetIds(
        candidates.filter((id) => !liveProtected.has(id)),
        {
          pageAssetIds: pageRefs.map((p) => p.assetId),
          coverAssetIds: coverRefs.map((b) => b.coverAssetId),
          avatarAssetIds: avatarRefs.map((a) => a.assetId),
        },
      );
      if (deletable.length === 0) continue;
      const assets = await prisma.asset.findMany({
        where: { id: { in: deletable }, userId },
        select: { id: true, publicId: true },
      });
      if (assets.length === 0) continue;
      await getAssetCleanupQueue().add(
        'detection-sweep-cleanup',
        {
          publicIds: assets.map((a) => a.publicId),
          reason: 'detection_expired',
          userId,
        } satisfies AssetCleanupJobPayload,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 15000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      );
      await prisma.asset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } });
      logger.info(
        { userId, reaped: assets.length },
        'Detection sweep: reaped orphaned staged photos from an abandoned session',
      );
    } catch (error) {
      // This user's rows stay for the next pass; keep sweeping the others.
      logger.warn(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Detection sweep: user reap failed — rows retained for retry',
      );
      failedUsers.add(userId);
    }
  }

  const deletableRowIds = expired
    .filter((event) => !event.userId || !failedUsers.has(event.userId))
    .map((event) => event.id);
  if (deletableRowIds.length > 0) {
    await prisma.appEvent.deleteMany({ where: { id: { in: deletableRowIds } } });
  }
  return piiRows.length + deletableRowIds.length;
}

/**
 * Weekly draft-retention sweep. DRY-RUN by default: candidates are logged and
 * recorded as 'draft_sweep_candidate' AppEvents (once per book) so the owner
 * can see exactly what a real sweep would remove. With ASSET_CLEANUP_ENFORCE
 * =true it deletes the book row (existing cascade removes pages) and enqueues
 * the book's Cloudinary content through the same deletion path as a manual
 * book delete. Non-DRAFT books are never touched — the status is checked in
 * the query, re-checked in code, and enforced once more in the conditional
 * deleteMany. Defensive by design: never throws out of the handler.
 */
async function runDraftSweep(job: Job) {
  const summary = { scanned: 0, flagged: 0, swept: 0, skipped: 0 };
  const now = new Date();
  const retentionDays = resolveDraftRetentionDays(process.env.DRAFT_RETENTION_DAYS);
  const enforce = isCleanupEnforced(process.env.ASSET_CLEANUP_ENFORCE);
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  try {
    // Reconcile first: recover any deletion job lost in a previous sweep's (or
    // the web delete route's) delete→enqueue gap. Never fatal to the sweep.
    try {
      await reconcilePendingCleanups(now);
    } catch (reconcileError) {
      logger.error(
        {
          error: reconcileError instanceof Error ? reconcileError.message : String(reconcileError),
        },
        'Asset cleanup reconcile pass failed — continuing with sweep',
      );
    }

    // Batch-studio retention backstop: purge every user's expired detection
    // rows (subject PII) and reap abandoned staged photos. Never fatal.
    try {
      const sweptDetections = await sweepExpiredDetectionEvents(now);
      if (sweptDetections > 0) {
        logger.info({ sweptDetections }, 'Detection sweep: expired detection rows purged');
      }
    } catch (detectionError) {
      logger.error(
        {
          error: detectionError instanceof Error ? detectionError.message : String(detectionError),
        },
        'Detection sweep failed — continuing with draft sweep',
      );
    }

    const candidates: SweepCandidate[] = await prisma.book.findMany({
      where: { status: 'DRAFT', updatedAt: { lt: cutoff } },
      orderBy: { updatedAt: 'asc' },
      take: DRAFT_SWEEP_BATCH_SIZE,
      select: {
        id: true,
        userId: true,
        status: true,
        updatedAt: true,
        coverAssetId: true,
        coverImageUrl: true,
        characterReferences: true,
        pages: { select: { assetId: true, generatedImageUrl: true, updatedAt: true } },
      },
    });
    summary.scanned = candidates.length;

    for (const book of candidates) {
      try {
        // Staleness anchors on the newest write across the book AND its pages
        // (reaper pattern): photo uploads, reorders, and page-text edits only
        // touch Page/Asset rows, so Book.updatedAt alone would sweep a draft
        // the parent is actively editing.
        const lastActivity = computeLastActivity(
          book.updatedAt,
          book.pages.map((p) => p.updatedAt),
        );
        if (
          !isDraftSweepCandidate(
            { status: book.status, updatedAt: lastActivity },
            now,
            retentionDays,
          )
        ) {
          summary.skipped += 1;
          continue;
        }

        const ageDays = Math.floor(
          (now.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000),
        );

        if (!enforce) {
          logger.info(
            { bookId: book.id, userId: book.userId, ageDays, retentionDays },
            'Draft sweep DRY-RUN: stale draft would be deleted (set ASSET_CLEANUP_ENFORCE=true to enforce)',
          );
          // One AppEvent per book, not one per weekly sweep.
          const alreadyFlagged = await prisma.appEvent.count({
            where: { name: 'draft_sweep_candidate', bookId: book.id },
          });
          if (alreadyFlagged === 0) {
            await trackEvent(
              prisma,
              {
                name: 'draft_sweep_candidate',
                userId: book.userId,
                bookId: book.id,
                props: { ageDays, retentionDays },
              },
              logger,
            );
          }
          summary.flagged += 1;
          continue;
        }

        // Collect BEFORE the row disappears; enqueue AFTER the delete commits.
        const targets = await collectBookCleanupTargets(book);

        // Durable pre-delete record (direct create, NOT trackEvent — this one
        // must THROW on failure): if the enqueue below is lost, the reconcile
        // pass re-enqueues from these props. A failed write skips the book —
        // it is still in the DB, so next week's sweep retries.
        await prisma.appEvent.create({
          data: {
            name: ASSET_CLEANUP_PENDING_EVENT,
            userId: book.userId,
            bookId: book.id,
            props: {
              publicIds: targets.publicIds,
              prefixes: targets.prefixes,
              reason: 'draft_expired',
            },
          },
        });

        // Conditional transition: if the parent touched the draft (book row OR
        // any page row) between the candidate query and now, count === 0 and
        // nothing happens. The pages relation filter makes the page-activity
        // check atomic with the delete itself.
        const deleted = await prisma.book.deleteMany({
          where: {
            id: book.id,
            status: 'DRAFT',
            updatedAt: { lt: cutoff },
            pages: { none: { updatedAt: { gte: cutoff } } },
          },
        });
        if (deleted.count === 0) {
          // Best-effort: the book survived, so the pending marker is stale.
          // (Reconcile would also drop it after noticing the book exists.)
          await prisma.appEvent
            .deleteMany({ where: { name: ASSET_CLEANUP_PENDING_EVENT, bookId: book.id } })
            .catch(() => {});
          summary.skipped += 1;
          continue;
        }

        await trackEvent(
          prisma,
          {
            name: 'draft_swept',
            userId: book.userId,
            bookId: book.id,
            props: { ageDays, retentionDays, publicIdCount: targets.publicIds.length },
          },
          logger,
        );

        try {
          await getAssetCleanupQueue().add(
            `cleanup-draft-${book.id}`,
            {
              publicIds: targets.publicIds,
              prefixes: targets.prefixes,
              reason: 'draft_expired',
              userId: book.userId,
              bookId: book.id,
            } satisfies AssetCleanupJobPayload,
            {
              // Deterministic id so reconcile re-enqueues dedupe against this.
              jobId: `cleanup-draft-${book.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 10000 },
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 500 },
            },
          );
        } catch (queueError) {
          // The book row is already gone — log the FULL target list (manual
          // recovery needs it) and rely on the pending record + reconcile
          // pass to re-enqueue.
          logger.error(
            {
              bookId: book.id,
              userId: book.userId,
              publicIds: targets.publicIds,
              prefixes: targets.prefixes,
              error: queueError instanceof Error ? queueError.message : String(queueError),
            },
            'Draft sweep: FAILED to enqueue asset cleanup — reconcile pass will retry from the pending record',
          );
          summary.swept += 1;
          continue;
        }

        logger.info(
          {
            bookId: book.id,
            userId: book.userId,
            ageDays,
            publicIdCount: targets.publicIds.length,
          },
          'Draft sweep: expired draft deleted and asset cleanup enqueued',
        );
        summary.swept += 1;
      } catch (error) {
        // One broken book must not stop the sweep for the rest.
        logger.error(
          { bookId: book.id, error: error instanceof Error ? error.message : String(error) },
          'Draft sweep: failed to process candidate',
        );
      }
    }

    if (summary.scanned > 0) {
      logger.info({ jobId: job.id, enforce, retentionDays, ...summary }, 'Draft sweep finished');
    }
  } catch (error) {
    logger.error(
      { jobId: job.id, error: error instanceof Error ? error.message : String(error) },
      'Draft sweep failed',
    );
  }

  return summary;
}

/**
 * One queue, two job shapes: the repeatable draft-retention sweep (matched by
 * job name) and enqueued deletion jobs from the book DELETE route, the Clerk
 * user.deleted webhook, and the sweep itself.
 */
export async function processAssetCleanup(job: Job) {
  if (job.name === DRAFT_SWEEP_JOB_NAME) {
    return runDraftSweep(job);
  }
  return runAssetDeletion(job);
}
