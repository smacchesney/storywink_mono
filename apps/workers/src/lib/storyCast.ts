/**
 * Pure helpers for assembling the story prompt's cast + confirmed facts.
 *
 * Kept dependency-free so the logic is unit-testable without touching
 * Prisma, BullMQ, or OpenAI.
 */

/** Sentinel stored by CaptureChips when the parent taps "Skip". */
export const SKIP_SENTINEL = '__skip__';

export interface CaptureQuestionLike {
  question: string;
  answer?: string | null;
}

/**
 * Turn answered capture questions into "question → answer" fact lines for
 * the story prompt. Unanswered, blank, and skipped questions are dropped —
 * the '__skip__' sentinel must never reach the model.
 */
export function buildConfirmedFacts(questions: CaptureQuestionLike[] | null | undefined): string[] {
  return (questions ?? [])
    .filter((q) => {
      const answer = q.answer?.trim();
      return !!answer && answer !== SKIP_SENTINEL;
    })
    .map((q) => `${q.question} → ${q.answer}`);
}

export interface RawCastCharacter {
  characterId: string;
  role: string;
  name: string | null;
  appearsOnPages: number[];
  appearsOnAssetIds?: (string | null)[];
}

export interface ResolvedCastMember {
  /** Stable roster id, carried through to the prompt so bridge pages (which
   * reference characters by id) can be grounded and validated. */
  characterId: string;
  name: string;
  role: string;
  /** Exact 1-based current page positions; empty = pages unknown (page-less prompt variant). */
  appearsOnPages: number[];
}

/**
 * Per-character partial remap of the perception roster onto the CURRENT
 * page order. Unlike the shared remapCharacterPages (which is deliberately
 * all-or-nothing so character-extraction re-extracts on any staleness), the
 * story prompt can degrade per character when photos were removed:
 *
 * - every stamped asset still on the book → exact current pages
 * - some stamped assets gone → keep the character, but page-less
 *   (appearsOnPages: []) so the prompt never asserts wrong page numbers
 * - no stamped asset survives (or no stamps at all) → drop the character;
 *   a person whose photos the parent removed must never re-enter the story
 */
export function resolveCastForStory(
  characters: RawCastCharacter[],
  currentOrderedAssetIds: (string | null)[],
): ResolvedCastMember[] {
  const positionByAsset = new Map<string, number>();
  currentOrderedAssetIds.forEach((assetId, index) => {
    if (assetId) positionByAsset.set(assetId, index + 1);
  });

  const resolved: ResolvedCastMember[] = [];
  for (const character of characters) {
    const stamps = (character.appearsOnAssetIds ?? []).filter((id): id is string => !!id);
    if (stamps.length === 0) continue; // legacy identity without stamps — nothing verifiable

    const pages = stamps
      .map((id) => positionByAsset.get(id))
      .filter((p): p is number => p !== undefined);
    if (pages.length === 0) continue; // every photo with this character was removed

    resolved.push({
      characterId: character.characterId,
      name: character.name || character.role.replace(/_/g, ' '),
      role: character.role,
      appearsOnPages:
        pages.length === stamps.length ? [...new Set(pages)].sort((a, b) => a - b) : [],
    });
  }
  return resolved;
}
