import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { avatarsEnabled, getAvatarCleanupQueue } from '@/lib/avatars';
import {
  collectAvatarGeneratedPublicIds,
  avatarGeneratedFolderPrefix,
  excludeSharedAssetIds,
  ASSET_CLEANUP_PENDING_EVENT,
  type AssetCleanupJobPayload,
} from '@storywink/shared';

type RouteContext = { params: Promise<{ avatarId: string }> };

const renameSchema = z.object({ displayName: z.string().min(1).max(50) });

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (!avatarsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { avatarId } = await params;
  try {
    const { dbUser } = await getAuthenticatedUser();
    const parsed = renameSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const updated = await prisma.avatar.updateMany({
      where: { id: avatarId, userId: dbUser.id },
      data: { displayName: parsed.data.displayName },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ avatarId, error }, 'Avatar rename failed');
    return NextResponse.json({ error: 'Failed to rename character' }, { status: 500 });
  }
}

/**
 * Delete a character: collect its Cloudinary targets (renditions + folder,
 * plus staged photos nothing else references), write the durable pending
 * marker, cascade-delete the row, enqueue cleanup. Mirrors book deletion.
 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  if (!avatarsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { avatarId } = await params;
  try {
    const { dbUser } = await getAuthenticatedUser();
    const avatar = await prisma.avatar.findUnique({
      where: { id: avatarId, userId: dbUser.id },
      include: {
        renditions: { select: { turnaroundSheetUrl: true, portraitUrl: true } },
        photos: { select: { assetId: true } },
      },
    });
    if (!avatar) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

    // X6d guard: an avatar starring in avatar-first stories is load-bearing —
    // deleting it would cascade the BookAvatar links and wipe the rendition
    // sheets those books need for every re-render. The parent deletes the
    // books first (or keeps the character); a silent brick is never OK.
    const starringIn = await prisma.bookAvatar.count({
      where: { avatarId, book: { bookType: 'AVATAR_STORY' } },
    });
    if (starringIn > 0) {
      return NextResponse.json(
        { code: 'STARS_IN_STORIES', count: starringIn },
        { status: 409 },
      );
    }

    // Staged photos are deletable only when no book page/cover and no other
    // avatar references the same asset.
    const stagedAssetIds = avatar.photos.map((p) => p.assetId);
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
    const deletableAssetIds = excludeSharedAssetIds(stagedAssetIds, [
      ...pageRefs.map((p) => p.assetId),
      ...coverRefs.map((b) => b.coverAssetId),
      ...otherAvatarRefs.map((a) => a.assetId),
    ]);
    const deletableAssets = await prisma.asset.findMany({
      where: { id: { in: deletableAssetIds } },
      select: { publicId: true },
    });

    const payload: AssetCleanupJobPayload = {
      publicIds: Array.from(
        new Set([
          ...deletableAssets.map((a) => a.publicId),
          ...collectAvatarGeneratedPublicIds(avatar.renditions),
        ]),
      ),
      prefixes: [avatarGeneratedFolderPrefix(avatarId)],
      reason: 'avatar_deleted',
      userId: dbUser.id,
    };

    await prisma.appEvent.create({
      data: {
        name: ASSET_CLEANUP_PENDING_EVENT,
        userId: dbUser.id,
        props: { ...payload },
      },
    });
    await prisma.$transaction([
      prisma.avatar.delete({ where: { id: avatarId } }),
      prisma.asset.deleteMany({ where: { id: { in: deletableAssetIds } } }),
    ]);

    try {
      await getAvatarCleanupQueue().add('avatar-cleanup', payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 15000 },
      });
    } catch (queueError) {
      // The pending marker lets the reconcile pass re-enqueue.
      logger.error({ avatarId, error: queueError }, 'Avatar cleanup enqueue failed (marker persists)');
    }

    logger.info({ avatarId }, 'Character deleted');
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ avatarId, error }, 'Avatar deletion failed');
    return NextResponse.json({ error: 'Failed to delete character' }, { status: 500 });
  }
}
