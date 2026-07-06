import { Job, Queue } from 'bullmq';
import { v2 as cloudinary } from 'cloudinary';
import prisma from '../database/index.js';
import { QUEUE_NAMES } from '@storywink/shared/constants';
import { createBullMQConnection } from '@storywink/shared/redis';
import {
  trackEvent,
  assetCleanupJobSchema,
  type AssetCleanupJobPayload,
  collectBookGeneratedPublicIds,
  bookGeneratedFolderPrefix,
  isSafeCloudinaryPrefix,
  excludeSharedAssetIds,
  isDraftSweepCandidate,
  chunkPublicIds,
} from '@storywink/shared';
import pino from 'pino';
import {
  DRAFT_SWEEP_JOB_NAME,
  DRAFT_SWEEP_BATCH_SIZE,
  CLOUDINARY_DELETE_CHUNK_SIZE,
  MAX_PREFIX_DELETE_ITERATIONS,
  resolveDraftRetentionDays,
  isCleanupEnforced,
  summarizeDeletionResponse,
  addCounts,
  type DeletionCounts,
} from './asset-cleanup.helpers.js';

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
  throw new Error(`Prefix delete incomplete for ${prefix} after ${MAX_PREFIX_DELETE_ITERATIONS} iterations`);
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
  pages: Array<{ assetId: string | null; generatedImageUrl: string | null }>;
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
    ...new Set([
      ...deletableAssets.map((a) => a.publicId),
      ...collectBookGeneratedPublicIds(book),
    ]),
  ];

  return { publicIds, prefixes: [bookGeneratedFolderPrefix(book.id)] };
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
        pages: { select: { assetId: true, generatedImageUrl: true } },
      },
    });
    summary.scanned = candidates.length;

    for (const book of candidates) {
      try {
        if (!isDraftSweepCandidate(book, now, retentionDays)) {
          summary.skipped += 1;
          continue;
        }

        const ageDays = Math.floor(
          (now.getTime() - book.updatedAt.getTime()) / (24 * 60 * 60 * 1000),
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

        // Conditional transition: if the parent touched the draft between the
        // candidate query and now, count === 0 and nothing happens.
        const deleted = await prisma.book.deleteMany({
          where: { id: book.id, status: 'DRAFT', updatedAt: { lt: cutoff } },
        });
        if (deleted.count === 0) {
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
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 500 },
          },
        );

        logger.info(
          { bookId: book.id, userId: book.userId, ageDays, publicIdCount: targets.publicIds.length },
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
