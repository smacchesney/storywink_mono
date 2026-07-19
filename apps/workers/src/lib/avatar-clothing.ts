/**
 * X15 clothing-consistency safety: when a VALIDATED avatar sheet shows
 * different clothing than the stored identity text describes, the approved
 * sheet is the truth the owner sees (shelf cutout, book render anchor) — so
 * the TEXT reconciles to the SHEET, never the other way. Without this, book
 * prompts carry the contradicting text and out-paint the sheet (the Kai
 * blue-vs-orange bug).
 */
import OpenAI from 'openai';
import type { Logger } from 'pino';
import prisma from '../database/index.js';
import { trackEvent } from '@storywink/shared';
import { ANALYSIS_MODEL, ANALYSIS_OPENAI_TIMEOUT_MS } from '../config/models.js';

interface ClothingCharacter {
  typicalClothing?: string | null;
  styleTranslation?: string | null;
  [key: string]: unknown;
}

/** Stored Avatar.identity: nested under `.character` (current) or flat (legacy). */
type StoredIdentity = ({ character: ClothingCharacter } | ClothingCharacter) &
  Record<string, unknown>;

/**
 * Pure: return a deep-enough copy with typicalClothing (and, when supplied,
 * styleTranslation) replaced, preserving the stored nesting shape exactly.
 */
export function applyClothingToIdentity<T extends StoredIdentity>(
  identity: T,
  observedClothing: string,
  rewrittenStyleTranslation: string | null,
): T {
  const nested = 'character' in identity && identity.character !== null;
  const target = (nested ? (identity as { character: ClothingCharacter }).character : identity) as ClothingCharacter;
  const patched: ClothingCharacter = {
    ...target,
    typicalClothing: observedClothing,
    ...(rewrittenStyleTranslation ? { styleTranslation: rewrittenStyleTranslation } : {}),
  };
  return (nested ? { ...identity, character: patched } : patched) as T;
}

export function buildStyleTranslationRewritePrompt(
  styleTranslation: string,
  observedClothing: string,
): string {
  return [
    `Below is a style-rendering description for a picture-book character. Its clothing details are WRONG.`,
    `The character's actual clothing is: ${observedClothing}`,
    `Rewrite the description so every clothing reference (garments, their colors, materials) matches the actual clothing. Change NOTHING else — keep every non-clothing sentence, the art-technique instructions, and the overall length and tone identical. Return ONLY the rewritten description.`,
    `DESCRIPTION:`,
    styleTranslation,
  ].join('\n\n');
}

/**
 * Reconcile the avatar's stored identity text to the clothing observed on its
 * just-validated sheet. All-or-nothing: if the styleTranslation rewrite fails,
 * nothing is persisted (a half-reconciled identity would still contradict
 * itself in prompts). Never throws — a failed reconcile only logs; the
 * rendition stays READY.
 */
export async function reconcileAvatarClothing(params: {
  openai: OpenAI;
  avatarId: string;
  userId: string;
  observedClothing: string;
  logger: Logger;
}): Promise<void> {
  const { openai, avatarId, userId, observedClothing, logger } = params;
  try {
    const avatar = await prisma.avatar.findUnique({ where: { id: avatarId } });
    const identity = avatar?.identity as StoredIdentity | null;
    if (!identity) return;
    const character = ('character' in identity ? identity.character : identity) as ClothingCharacter;
    if (!character) return;

    let rewrittenStyle: string | null = null;
    if (typeof character.styleTranslation === 'string' && character.styleTranslation.trim()) {
      const result = await openai.responses.create(
        {
          model: ANALYSIS_MODEL,
          input: buildStyleTranslationRewritePrompt(character.styleTranslation, observedClothing),
        },
        { timeout: ANALYSIS_OPENAI_TIMEOUT_MS },
      );
      rewrittenStyle = result.output_text?.trim() || null;
      if (!rewrittenStyle) {
        logger.warn(
          { avatarId },
          'Clothing reconcile skipped: styleTranslation rewrite returned empty',
        );
        return;
      }
    }

    const patched = applyClothingToIdentity(identity, observedClothing, rewrittenStyle);
    await prisma.avatar.update({
      where: { id: avatarId },
      data: { identity: patched as unknown as object },
    });
    await trackEvent(
      prisma,
      {
        name: 'avatar_identity_clothing_reconciled',
        userId,
        props: { avatarId, observedClothing },
      },
      logger,
    );
    logger.info(
      { avatarId, observedClothing },
      'Identity clothing reconciled to the validated sheet',
    );
  } catch (error) {
    logger.warn(
      { avatarId, error: error instanceof Error ? error.message : 'Unknown error' },
      'Clothing reconcile failed (non-fatal) — identity text left unchanged',
    );
  }
}
