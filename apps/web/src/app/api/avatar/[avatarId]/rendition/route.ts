import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { avatarsEnabled } from '@/lib/avatars';
import { QueueName, getQueue } from '@/lib/queue/index';
import { isValidStyle } from '@storywink/shared/prompts/styles';

type RouteContext = { params: Promise<{ avatarId: string }> };

const renditionSchema = z.object({
  artStyle: z.string().refine(isValidStyle, 'Unknown art style'),
});

/**
 * "Draw again" and new-style renditions share this endpoint: the worker
 * upserts the (avatarId, artStyle) row to PENDING and regenerates — from
 * staged photos when they still exist, else derived from a READY rendition.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!avatarsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { avatarId } = await params;
  try {
    const { dbUser } = await getAuthenticatedUser();
    const parsed = renditionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const avatar = await prisma.avatar.findUnique({
      where: { id: avatarId, userId: dbUser.id },
      select: { id: true },
    });
    if (!avatar) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

    await prisma.avatarRendition.upsert({
      where: { avatarId_artStyle: { avatarId, artStyle: parsed.data.artStyle } },
      create: { avatarId, artStyle: parsed.data.artStyle, status: 'PENDING' },
      update: { status: 'PENDING', error: null },
    });
    await getQueue(QueueName.AvatarRendition).add(
      `avatar-${avatarId}-${parsed.data.artStyle}`,
      { avatarId, userId: dbUser.id, artStyle: parsed.data.artStyle },
      { attempts: 2, backoff: { type: 'exponential', delay: 10000 } },
    );
    return NextResponse.json({ success: true }, { status: 202 });
  } catch (error) {
    logger.error({ avatarId, error }, 'Rendition enqueue failed');
    return NextResponse.json({ error: 'Failed to start drawing' }, { status: 500 });
  }
}
