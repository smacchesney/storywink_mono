import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { avatarsEnabled, getAvatarCleanupQueue } from '@/lib/avatars';
import {
  excludeSharedAssetIds,
  ASSET_CLEANUP_PENDING_EVENT,
  type AssetCleanupJobPayload,
} from '@storywink/shared';

type RouteContext = { params: Promise<{ avatarId: string }> };

/**
 * Approval = the parent keeps this character. Per the delete-after-approval
 * retention posture (owner decision 2026-07-12), the staged source photos
 * are removed here: AvatarPhoto links always; Asset rows + Cloudinary bytes
 * only when no book page/cover and no other avatar references them. The
 * identity lives on solely in the trait descriptor and the renditions —
 * "we keep the drawing, not the photos."
 */
export async function POST(_request: NextRequest, { params }: RouteContext) {
  if (!avatarsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { avatarId } = await params;
  try {
    const { dbUser } = await getAuthenticatedUser();
    const avatar = await prisma.avatar.findUnique({
      where: { id: avatarId, userId: dbUser.id },
      include: { photos: { select: { assetId: true } } },
    });
    if (!avatar) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

    const stagedAssetIds = avatar.photos.map((p) => p.assetId);
    let deletableAssetIds: string[] = [];
    if (stagedAssetIds.length > 0) {
      const [pageRefs, coverRefs, otherAvatarRefs] = await Promise.all([
        prisma.page.findMany({
          where: { assetId: { in: stagedAssetIds } },
          select: { assetId: true },
        }),
        prisma.book.findMany({
          where: { coverAssetId: { in: stagedAssetIds } },
          select: { coverAssetId: true },
        }),
        prisma.avatarPhoto.findMany({
          where: { assetId: { in: stagedAssetIds }, avatarId: { not: avatarId } },
          select: { assetId: true },
        }),
      ]);
      deletableAssetIds = excludeSharedAssetIds(stagedAssetIds, [
        ...pageRefs.map((p) => p.assetId),
        ...coverRefs.map((b) => b.coverAssetId),
        ...otherAvatarRefs.map((a) => a.assetId),
      ]);
    }
    const deletableAssets = await prisma.asset.findMany({
      where: { id: { in: deletableAssetIds } },
      select: { publicId: true },
    });

    const payload: AssetCleanupJobPayload | null =
      deletableAssets.length > 0
        ? {
            publicIds: deletableAssets.map((a) => a.publicId),
            reason: 'avatar_approved',
            userId: dbUser.id,
          }
        : null;

    if (payload) {
      await prisma.appEvent.create({
        data: { name: ASSET_CLEANUP_PENDING_EVENT, userId: dbUser.id, props: { ...payload } },
      });
    }
    await prisma.$transaction([
      prisma.avatar.update({ where: { id: avatarId }, data: { status: 'READY' } }),
      prisma.avatarPhoto.deleteMany({ where: { avatarId } }),
      prisma.asset.deleteMany({ where: { id: { in: deletableAssetIds } } }),
    ]);
    if (payload) {
      try {
        await getAvatarCleanupQueue().add('avatar-approved-cleanup', payload, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 15000 },
        });
      } catch (queueError) {
        logger.error({ avatarId, error: queueError }, 'Approve cleanup enqueue failed (marker persists)');
      }
    }

    logger.info(
      { avatarId, stagedPhotos: stagedAssetIds.length, deleted: deletableAssetIds.length },
      'Avatar approved; staged photos released',
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ avatarId, error }, 'Avatar approval failed');
    return NextResponse.json({ error: 'Failed to approve character' }, { status: 500 });
  }
}
