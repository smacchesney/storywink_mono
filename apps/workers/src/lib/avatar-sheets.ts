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

/**
 * Pick which rendition's sheet may join the reference stack (pure, tested).
 *
 * READY always wins. A non-READY rendition still holding a sheet (a "draw
 * again" flips the row to PENDING but keeps the last good URL) is accepted
 * ONLY for AVATAR_STORY books — their re-renders have no other anchor and
 * must not fail mid-redraw. Photo books (X6c) stay READY-only: the sheet is
 * an optional consistency boost there, and a stale one is worse than none.
 */
export function pickRenditionSheet(
  renditions: { status: string; turnaroundSheetUrl: string | null }[],
  bookType: string | null | undefined,
): string | null {
  const ready = renditions.find((r) => r.status === 'READY' && r.turnaroundSheetUrl);
  if (ready) return ready.turnaroundSheetUrl;
  if (bookType !== 'AVATAR_STORY') return null;
  return renditions.find((r) => r.turnaroundSheetUrl)?.turnaroundSheetUrl ?? null;
}

/** Merge core (pure, tested): avatar refs lead and override same-id base refs. */
export function mergeSheetRefs(
  avatarRefs: CharacterSheetRef[],
  base: CharacterSheetRef[] | undefined,
): CharacterSheetRef[] {
  const overridden = new Set(avatarRefs.map((r) => r.characterId));
  return [...avatarRefs, ...(base ?? []).filter((r) => !overridden.has(r.characterId))];
}

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
              // Any rendition still holding a sheet counts: a "draw again"
              // flips the row to PENDING but keeps the last good sheet URL,
              // and a re-render mid-redraw must keep its anchor rather than
              // fail the page. READY is preferred below.
              where: { artStyle: artStyle ?? 'vignette', turnaroundSheetUrl: { not: null } },
            },
          },
        },
      },
    });

    const avatarRefs: CharacterSheetRef[] = [];
    for (const link of links) {
      const sheetUrl = pickRenditionSheet(link.avatar.renditions, bookType);
      if (!link.characterId || !sheetUrl) continue;
      avatarRefs.push({
        characterId: link.characterId,
        name: link.avatar.displayName,
        url: sheetUrl,
      });
    }

    if (avatarRefs.length === 0) return base;

    const merged = mergeSheetRefs(avatarRefs, base);
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
