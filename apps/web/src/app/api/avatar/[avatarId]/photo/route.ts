import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@storywink/database';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { avatarsEnabled, reapUnattachedStagedAssets } from '@/lib/avatars';
import { checkRateLimit } from '@/lib/rateLimit';

type RouteContext = { params: Promise<{ avatarId: string }> };

const photoSchema = z.object({
  assetId: z.string().cuid(),
  /** Clear the stored identity so the next rendition re-learns from this photo. */
  relearn: z.boolean().optional(),
});

/**
 * Attach a fresh photo to an existing character (X11 Track F, F1). The redraw
 * recovery path: when a "draw again" has no source to draw from (photos let go
 * at approval, no other-style sheet), the parent adds one clear photo here, then
 * the client POSTs the rendition route to start the redraw.
 *
 * REPLACE semantics: the avatar's existing staged photos are released so an old
 * group shot can't linger and re-poison identity extraction. Old Asset rows and
 * bytes follow the same retention rules as approval — reapUnattachedStagedAssets
 * drops only the ones nothing else references (page / cover / other avatar) and
 * leaves the rest for a later sweep. The incoming asset is never released.
 *
 * With `relearn`, Avatar.identity is set to SQL NULL so the rendition worker
 * re-extracts identity from the new photo (avatar-rendition.worker.ts's
 * `if (!identity?.character)` branch). A solo re-uploaded photo carries no
 * detect-stage description, so extraction has no group to disambiguate.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!avatarsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { avatarId } = await params;
  try {
    const { dbUser } = await getAuthenticatedUser();

    // Staged-photo uploads already spent a Cloudinary round-trip; this is a
    // write route. Cap the burst unconditionally like the detect route — 20/hr
    // is well above any real parent. (checkRateLimit fails open if Redis is down.)
    const rl = await checkRateLimit(`avatar-photo:${dbUser.id}`, 20, 3600);
    if (!rl.allowed) {
      logger.warn({ dbUserId: dbUser.id }, 'Rate limit exceeded: avatar photo');
      return NextResponse.json(
        { error: "You're going very quickly. Please wait a little while and try again." },
        { status: 429 },
      );
    }

    const parsed = photoSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { assetId, relearn } = parsed.data;

    // Ownership pin: the avatar is the caller's.
    const avatar = await prisma.avatar.findUnique({
      where: { id: avatarId, userId: dbUser.id },
      include: { photos: { select: { assetId: true } } },
    });
    if (!avatar) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

    // Ownership pin: the incoming asset is the caller's own upload (mirrors the
    // studio/batch staged-photo checks). Nothing about a book reference blocks
    // reuse — pages and avatars may share an Asset, and the retention guards
    // keep a page-referenced asset from being released.
    const newAsset = await prisma.asset.findUnique({
      where: { id: assetId, userId: dbUser.id },
      select: { id: true },
    });
    if (!newAsset) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

    const oldAssetIds = avatar.photos.map((p) => p.assetId).filter((id) => id !== assetId);

    // Swap the staged photos and (optionally) clear identity atomically.
    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.avatarPhoto.deleteMany({ where: { avatarId } }),
      prisma.avatarPhoto.create({ data: { avatarId, assetId } }),
    ];
    if (relearn) {
      ops.push(
        prisma.avatar.update({ where: { id: avatarId }, data: { identity: Prisma.DbNull } }),
      );
    }
    await prisma.$transaction(ops);

    // Release the replaced photos through the same retention path approval uses
    // — byte deletion rides ASSET_CLEANUP_ENFORCE, referenced assets stay, and a
    // failure just leaves orphans for a later sweep. Never throws.
    if (oldAssetIds.length > 0) {
      await reapUnattachedStagedAssets(dbUser.id, oldAssetIds);
    }

    logger.info(
      { avatarId, released: oldAssetIds.length, relearn: relearn ?? false },
      'Avatar fresh photo attached',
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ avatarId, error }, 'Avatar photo attach failed');
    return NextResponse.json({ error: 'Failed to add the photo' }, { status: 500 });
  }
}
