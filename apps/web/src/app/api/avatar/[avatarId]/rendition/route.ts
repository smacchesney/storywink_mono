import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { avatarsEnabled } from '@/lib/avatars';
import { checkRateLimit } from '@/lib/rateLimit';
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

    // Renditions are a money route (one Gemini sheet + validation each) and
    // X6d's style-repair fans out one request per cast member — cap the burst.
    const rl = await checkRateLimit(`avatar-rendition:${dbUser.id}`, 30, 3600);
    if (!rl.allowed) {
      logger.warn({ dbUserId: dbUser.id, remaining: rl.remaining }, 'Rate limit exceeded: avatar rendition');
      if (process.env.RATE_LIMIT_ENFORCE === 'true') {
        return NextResponse.json(
          { error: "You're drawing very quickly. Please wait a little while and try again." },
          { status: 429 },
        );
      }
    }

    const parsed = renditionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const avatar = await prisma.avatar.findUnique({
      where: { id: avatarId, userId: dbUser.id },
      select: { id: true },
    });
    if (!avatar) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

    // Idempotent while drawing: a rendition already PENDING for this style is
    // already on its way — don't double-spend (X6d's repair poll can overlap
    // an impatient second tap).
    const existing = await prisma.avatarRendition.findUnique({
      where: { avatarId_artStyle: { avatarId, artStyle: parsed.data.artStyle } },
      select: { status: true },
    });
    if (existing?.status === 'PENDING') {
      return NextResponse.json({ success: true, alreadyDrawing: true }, { status: 202 });
    }

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
