import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { avatarsEnabled } from '@/lib/avatars';

type RouteContext = { params: Promise<{ bookId: string }> };

const linkSchema = z.object({
  avatarId: z.string().cuid(),
  /** Perception roster characterId this avatar plays in THIS book. */
  characterId: z.string().min(1).max(50),
});

/**
 * X6c: the parent confirmed "yes, that's {avatarName}" — link the account
 * avatar to this book so its rendition sheet anchors every page render.
 * Idempotent per (book, avatar).
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!avatarsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { bookId } = await params;
  try {
    const { dbUser } = await getAuthenticatedUser();
    const parsed = linkSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { avatarId, characterId } = parsed.data;

    const [book, avatar] = await Promise.all([
      prisma.book.findUnique({ where: { id: bookId, userId: dbUser.id }, select: { id: true } }),
      prisma.avatar.findUnique({ where: { id: avatarId, userId: dbUser.id }, select: { id: true } }),
    ]);
    if (!book || !avatar) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await prisma.bookAvatar.upsert({
      where: { bookId_avatarId: { bookId, avatarId } },
      create: { bookId, avatarId, characterId },
      update: { characterId },
    });
    logger.info({ bookId, avatarId, characterId }, 'Avatar linked to book');
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ bookId, error }, 'Avatar link failed');
    return NextResponse.json({ error: 'Failed to link character' }, { status: 500 });
  }
}
