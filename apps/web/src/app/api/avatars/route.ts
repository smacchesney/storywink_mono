import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { assertCanCreateAvatar } from '@/lib/entitlements';
import { avatarsEnabled } from '@/lib/avatars';
import { QueueName, getQueue } from '@/lib/queue/index';
import { isValidStyle } from '@storywink/shared/prompts/styles';

const createAvatarSchema = z.object({
  displayName: z.string().min(1).max(50),
  kind: z.enum(['CHILD', 'ADULT', 'PET', 'TOY']),
  assetIds: z.array(z.string().cuid()).min(1).max(5),
  artStyle: z.string().refine(isValidStyle, 'Unknown art style'),
});

/** List the account's characters, newest first, with their renditions. */
export async function GET() {
  if (!avatarsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const { dbUser } = await getAuthenticatedUser();
    const avatars = await prisma.avatar.findMany({
      where: { userId: dbUser.id },
      orderBy: { createdAt: 'desc' },
      include: {
        renditions: {
          select: {
            artStyle: true,
            status: true,
            turnaroundSheetUrl: true,
            portraitUrl: true,
            cutoutUrl: true,
            error: true,
          },
        },
      },
    });
    return NextResponse.json({ avatars });
  } catch (error) {
    logger.error({ error }, 'Avatar list failed');
    return NextResponse.json({ error: 'Failed to list characters' }, { status: 500 });
  }
}

/** Studio creation: stage photos, mint the avatar, enqueue its first rendition. */
export async function POST(request: NextRequest) {
  if (!avatarsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const { dbUser } = await getAuthenticatedUser();

    const parsed = createAvatarSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { displayName, kind, assetIds, artStyle } = parsed.data;

    const verdict = await assertCanCreateAvatar(dbUser.id);
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: 'avatar_cap', cap: verdict.cap },
        { status: 403 },
      );
    }

    // Ownership pin: every staged photo must be the caller's own upload.
    const ownedAssets = await prisma.asset.findMany({
      where: { id: { in: assetIds }, userId: dbUser.id },
      select: { id: true },
    });
    if (ownedAssets.length !== assetIds.length) {
      return NextResponse.json({ error: 'Invalid asset ownership' }, { status: 400 });
    }

    const avatar = await prisma.avatar.create({
      data: {
        userId: dbUser.id,
        displayName,
        kind,
        photos: { create: assetIds.map((assetId) => ({ assetId })) },
        renditions: { create: [{ artStyle, status: 'PENDING' }] },
      },
    });

    await getQueue(QueueName.AvatarRendition).add(
      `avatar-${avatar.id}-${artStyle}`,
      { avatarId: avatar.id, userId: dbUser.id, artStyle },
      { attempts: 2, backoff: { type: 'exponential', delay: 10000 } },
    );

    logger.info({ avatarId: avatar.id, kind, artStyle }, 'Avatar created, rendition enqueued');
    return NextResponse.json({ avatarId: avatar.id }, { status: 201 });
  } catch (error) {
    logger.error({ error }, 'Avatar creation failed');
    return NextResponse.json({ error: 'Failed to create character' }, { status: 500 });
  }
}
