/**
 * Linked account-avatar sheets → the illustration reference stack.
 *
 * X6c: avatars the parent linked to a photo book override the per-book sheet
 * for the same roster characterId — the cross-book anchor beats the one-book
 * sheet. X6d: for AVATAR_STORY books the linked avatars ARE the only identity
 * source, so the merge runs regardless of AVATARS_ENABLED (DB-row authority).
 *
 * Shared by createIllustrationFlow (first render) and book-finalize's QC
 * requeue — re-renders must keep the same reference stack the original
 * render had, or the QC round re-rolls without the cross-book anchor.
 */
import type { Logger } from 'pino';
import type { CharacterSheetRef } from '@storywink/shared';
import prisma from '../database/index.js';

export async function mergeLinkedAvatarSheets(opts: {
  bookId: string;
  userId: string;
  artStyle: string | null | undefined;
  bookType: string | null | undefined;
  base: CharacterSheetRef[] | undefined;
  logger: Logger;
}): Promise<CharacterSheetRef[] | undefined> {
  const { bookId, userId, artStyle, bookType, base, logger } = opts;

  if (process.env.AVATARS_ENABLED !== 'true' && bookType !== 'AVATAR_STORY') {
    return base;
  }

  try {
    const links = await prisma.bookAvatar.findMany({
      where: { bookId, avatar: { userId } },
      include: {
        avatar: {
          include: {
            renditions: {
              where: { status: 'READY', artStyle: artStyle ?? 'vignette' },
            },
          },
        },
      },
    });

    const avatarRefs: CharacterSheetRef[] = [];
    for (const link of links) {
      const sheetUrl = link.avatar.renditions[0]?.turnaroundSheetUrl;
      if (!link.characterId || !sheetUrl) continue;
      avatarRefs.push({
        characterId: link.characterId,
        name: link.avatar.displayName,
        url: sheetUrl,
      });
    }

    if (avatarRefs.length === 0) return base;

    const overridden = new Set(avatarRefs.map((r) => r.characterId));
    const merged = [...avatarRefs, ...(base ?? []).filter((r) => !overridden.has(r.characterId))];
    logger.info(
      { bookId, avatarSheets: avatarRefs.length },
      'Linked account-avatar sheets joined the reference stack',
    );
    return merged;
  } catch (error) {
    // Avatar reuse must never block illustration — degrade to book sheets.
    logger.warn({ bookId, error }, 'Avatar sheet lookup failed; continuing without');
    return base;
  }
}
