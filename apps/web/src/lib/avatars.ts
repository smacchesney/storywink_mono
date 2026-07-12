/**
 * Shared plumbing for the avatar (character library) routes.
 * Every avatar surface is dark behind AVATARS_ENABLED until X6 goes live.
 */
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@storywink/shared/constants';
import { createBullMQConnection } from '@storywink/shared/redis';
import { excludeSharedAssetIds, type AssetCleanupJobPayload } from '@storywink/shared';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';

export function avatarsEnabled(): boolean {
  return process.env.AVATARS_ENABLED === 'true';
}

/**
 * Reap staged upload photos the batch studio left unattached — the same
 * "we only use photos to draw, then let them go" retention promise the
 * confirm screen makes. An asset is deletable only when NO book page/cover
 * and NO avatar (created OR still staging) references it; the shared-asset
 * guard protects photos that also back a book.
 *
 * Ordering: ENQUEUE the Cloudinary cleanup BEFORE deleting the Asset rows,
 * so a crash after enqueue still deletes the bytes (the durable pending
 * marker the book-delete path relies on is inert here — the reconcile pass
 * skips userId-only markers). If the enqueue fails the rows stay put, so no
 * photo is ever orphaned in Cloudinary. Never throws into the caller.
 */
export async function reapUnattachedStagedAssets(
  dbUserId: string,
  candidateAssetIds: string[],
): Promise<void> {
  const ids = Array.from(
    new Set(candidateAssetIds.filter((id) => typeof id === 'string' && id.length)),
  );
  if (ids.length === 0) return;
  try {
    const [pageRefs, coverRefs, avatarRefs] = await Promise.all([
      prisma.page.findMany({ where: { assetId: { in: ids } }, select: { assetId: true } }),
      prisma.book.findMany({
        where: { coverAssetId: { in: ids } },
        select: { coverAssetId: true },
      }),
      prisma.avatarPhoto.findMany({ where: { assetId: { in: ids } }, select: { assetId: true } }),
    ]);
    const deletableAssetIds = excludeSharedAssetIds(ids, [
      ...pageRefs.map((p) => p.assetId),
      ...coverRefs.map((b) => b.coverAssetId),
      ...avatarRefs.map((a) => a.assetId),
    ]);
    if (deletableAssetIds.length === 0) return;

    const deletableAssets = await prisma.asset.findMany({
      where: { id: { in: deletableAssetIds }, userId: dbUserId },
      select: { id: true, publicId: true },
    });
    if (deletableAssets.length === 0) return;

    const payload: AssetCleanupJobPayload = {
      publicIds: deletableAssets.map((a) => a.publicId),
      reason: 'avatar_approved',
      userId: dbUserId,
    };
    // Queue the byte deletion first — if it throws we keep the rows and try
    // again on a later sweep rather than stranding bytes with dead DB pointers.
    await getAvatarCleanupQueue().add('avatar-cleanup', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 15000 },
    });
    await prisma.asset.deleteMany({ where: { id: { in: deletableAssets.map((a) => a.id) } } });
  } catch (error) {
    // A failure just leaves the photos; the next batch/sweep can reap them.
    logger.warn({ dbUserId, error }, 'reapUnattachedStagedAssets failed (non-fatal)');
  }
}

/** Maps a perception roster role onto the avatar kind for promotion. */
export function kindForRole(role: string): 'CHILD' | 'ADULT' | 'PET' | 'TOY' {
  if (role === 'main_child' || role.startsWith('main')) return 'CHILD';
  if (role === 'pet') return 'PET';
  if (role === 'companion_object') return 'TOY';
  return 'ADULT';
}

let cleanupQueue: Queue | null = null;
/** Lazy singleton — same pattern as the book-deletion route. */
export function getAvatarCleanupQueue(): Queue {
  if (!cleanupQueue) {
    cleanupQueue = new Queue(QUEUE_NAMES.ASSET_CLEANUP, {
      connection: createBullMQConnection(),
    });
  }
  return cleanupQueue;
}
