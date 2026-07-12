import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { assertCanCreateAvatar } from '@/lib/entitlements';
import { avatarsEnabled, kindForRole } from '@/lib/avatars';
import { QueueName, getQueue } from '@/lib/queue/index';

const promoteSchema = z.object({
  bookId: z.string().cuid(),
  characterId: z.string().min(1).max(50),
});

interface IdentityCharacter {
  characterId: string;
  role: string;
  name: string | null;
  appearsOnAssetIds?: (string | null)[];
  [key: string]: unknown;
}

/**
 * X6a promotion: one tap at the reveal turns a book character into an
 * account avatar. When the book already has a validated character sheet for
 * its art style, the worker byte-copies it into the avatar's own folder (the
 * parent keeps exactly the character they saw); otherwise the worker
 * generates a fresh rendition from the book photos that character appears in
 * (book photos are never staged for deletion — they belong to the book).
 */
export async function POST(request: NextRequest) {
  if (!avatarsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const { dbUser } = await getAuthenticatedUser();
    const parsed = promoteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { bookId, characterId } = parsed.data;

    const book = await prisma.book.findUnique({
      where: { id: bookId, userId: dbUser.id },
      select: {
        id: true,
        childName: true,
        artStyle: true,
        characterIdentity: true,
        characterReferences: true,
      },
    });
    if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

    const identity = book.characterIdentity as { characters?: IdentityCharacter[] } | null;
    const character = identity?.characters?.find((c) => c.characterId === characterId);
    if (!character) {
      return NextResponse.json({ error: 'Character not found in this book' }, { status: 404 });
    }

    const verdict = await assertCanCreateAvatar(dbUser.id);
    if (!verdict.allowed) {
      return NextResponse.json({ error: 'avatar_cap', cap: verdict.cap }, { status: 403 });
    }

    const kind = kindForRole(character.role);
    const displayName =
      (typeof character.name === 'string' && character.name.trim()) ||
      (kind === 'CHILD' && book.childName?.trim()) ||
      'My star';
    const artStyle = book.artStyle || 'vignette';

    // The book's validated sheet for this style, if the sheet pipeline made one.
    const references = Array.isArray(book.characterReferences)
      ? (book.characterReferences as Array<{
          characterId?: string;
          artStyle?: string;
          url?: string;
        }>)
      : [];
    const sheetUrl = references.find(
      (r) => r.characterId === characterId && r.artStyle === artStyle && typeof r.url === 'string',
    )?.url;

    // Without a sheet, the worker generates from the photos this character
    // appears in. Book assets are exempt from avatar-photo deletion by the
    // shared-asset guard (pages reference them).
    const sourceAssetIds = (character.appearsOnAssetIds ?? [])
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .slice(0, 3);
    if (!sheetUrl && sourceAssetIds.length === 0) {
      return NextResponse.json(
        { error: 'This character has nothing to draw from yet' },
        { status: 409 },
      );
    }

    const avatar = await prisma.avatar.create({
      data: {
        userId: dbUser.id,
        displayName,
        kind,
        promotedFromBookId: bookId,
        identity: { character: { ...character, name: displayName }, extractedForStyle: artStyle },
        photos: sheetUrl ? undefined : { create: sourceAssetIds.map((assetId) => ({ assetId })) },
        renditions: { create: [{ artStyle, status: 'PENDING' }] },
      },
    });

    await getQueue(QueueName.AvatarRendition).add(
      `avatar-${avatar.id}-${artStyle}`,
      {
        avatarId: avatar.id,
        userId: dbUser.id,
        artStyle,
        ...(sheetUrl ? { copyFromSheetUrl: sheetUrl } : {}),
      },
      { attempts: 2, backoff: { type: 'exponential', delay: 10000 } },
    );

    logger.info(
      { avatarId: avatar.id, bookId, characterId, viaSheet: !!sheetUrl },
      'Character promoted to account avatar',
    );
    return NextResponse.json({ avatarId: avatar.id, displayName }, { status: 201 });
  } catch (error) {
    logger.error({ error }, 'Avatar promotion failed');
    return NextResponse.json({ error: 'Failed to keep this character' }, { status: 500 });
  }
}
