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
  const target = (
    nested ? (identity as { character: ClothingCharacter }).character : identity
  ) as ClothingCharacter;
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
const STYLE_TRANSLATION_REWRITE_SCHEMA = {
  type: 'object',
  properties: { styleTranslation: { type: 'string' } },
  required: ['styleTranslation'],
  additionalProperties: false,
} as const;

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
    if (!avatar || !identity) return;
    const character = (
      'character' in identity ? identity.character : identity
    ) as ClothingCharacter;
    if (!character) return;

    let rewrittenStyle: string | null = null;
    if (typeof character.styleTranslation === 'string' && character.styleTranslation.trim()) {
      // Strict schema output: a preamble-wrapped or refusal reply must never
      // be persisted as the styleTranslation (it would corrupt every future
      // sheet/cutout/book prompt for this avatar).
      const result = await openai.responses.create(
        {
          model: ANALYSIS_MODEL,
          input: buildStyleTranslationRewritePrompt(character.styleTranslation, observedClothing),
          text: {
            format: {
              type: 'json_schema',
              name: 'style_translation_rewrite',
              strict: true,
              schema: STYLE_TRANSLATION_REWRITE_SCHEMA as unknown as Record<string, unknown>,
            },
          },
        },
        { timeout: ANALYSIS_OPENAI_TIMEOUT_MS },
      );
      const parsed = JSON.parse(result.output_text || '{}') as { styleTranslation?: string };
      rewrittenStyle = parsed.styleTranslation?.trim() || null;
      const original = character.styleTranslation;
      // Bound both directions: a ballooned rewrite AND a degenerate stub
      // ("Orange tee.") that dropped the art-technique prose are rejected.
      if (
        !rewrittenStyle ||
        rewrittenStyle.length > original.length * 2 + 200 ||
        rewrittenStyle.length < original.length / 3
      ) {
        logger.warn(
          { avatarId, rewrittenLength: rewrittenStyle?.length ?? 0 },
          'Clothing reconcile skipped: styleTranslation rewrite empty or out of bounds',
        );
        return;
      }
    }

    const patched = applyClothingToIdentity(identity, observedClothing, rewrittenStyle);
    // Compare-and-set on updatedAt: the read→LLM→write window spans seconds,
    // and a concurrent identity writer (relearn DbNull, a parallel style's
    // fresh extraction) must win over this reconcile, not be clobbered by it.
    const updated = await prisma.avatar.updateMany({
      where: { id: avatarId, updatedAt: avatar.updatedAt },
      data: { identity: patched as unknown as object },
    });
    if (updated.count === 0) {
      logger.warn(
        { avatarId },
        'Clothing reconcile skipped: avatar changed concurrently (stale read)',
      );
      return;
    }
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
