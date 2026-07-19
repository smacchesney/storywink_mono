/**
 * resolveCast — merges the parent's naming signal (capture-chip answers +
 * the setup sheet's childName) into the perception roster, and checks that
 * confirmed names actually land in the generated text.
 *
 * Used by BOTH the story-generation worker (merge + persist before the
 * story prompt is built) and the character-extraction worker (re-applied
 * before its reuse branch, closing the race where an in-flight DRAFT
 * perception refresh overwrites the roster after the story worker's merge).
 *
 * Pure and dependency-free (no Prisma/BullMQ/OpenAI) so the logic is
 * unit-testable.
 */

import {
  SKIP_SENTINEL,
  resolveCastForStory,
  RawCastCharacter,
  ResolvedCastMember,
} from './storyCast.js';
import { isChildNameCheckable } from '@storywink/shared/prompts/story-check';

export type NamedVia = 'chip' | 'childName' | 'fallback';

/** The capture-question shape the merge needs (structural subset). */
export interface CaptureAnswerLike {
  id: string;
  question?: string;
  answer?: string | null;
  characterId?: string | null;
}

/** The roster-entry shape the merge needs (structural subset of CharacterDescription). */
export interface MergeableCharacter {
  characterId: string;
  role: string;
  name: string | null;
  namedVia?: NamedVia;
}

export interface MergeCastResult<T extends MergeableCharacter> {
  /** The merged roster (deep-copied entries — inputs are never mutated). */
  characters: T[];
  /** True when any name/role/namedVia actually changed (persist only then). */
  changed: boolean;
  /**
   * Ids of the capture questions whose answers were CONSUMED by the merge.
   * Only these may be excluded from confirmedFacts — an answer whose join
   * failed must stay a fact, never be silently dropped.
   */
  consumedQuestionIds: string[];
}

// Category labels a toddler wouldn't say. They refine the character's ROLE;
// they must never become a name that castNameCoverage then demands verbatim
// in toddler prose ("Family friend clapped!").
const GENERIC_CATEGORY_ANSWERS = new Set([
  'family friend',
  'a family friend',
  'friend',
  'a friend',
  'friend of the family',
  'neighbor',
  'a neighbor',
  'neighbour',
  'a neighbour',
  'babysitter',
  'a babysitter',
  'teacher',
  'a teacher',
  'classmate',
  'a classmate',
  'someone else',
  // ja equivalents (normalized without spaces)
  'かぞくのともだち',
  'ともだち',
  'おともだち',
  'しりあい',
  'きんじょのひと',
  'せんせい',
  'ベビーシッター',
]);

/** "A friend's cat", "ともだちの ねこ" — generic pet categories, not names. */
export function isGenericCategoryAnswer(answer: string): boolean {
  const norm = answer.trim().toLowerCase().replace(/\s+/g, ' ');
  const compact = norm.replace(/ /g, '');
  if (GENERIC_CATEGORY_ANSWERS.has(norm) || GENERIC_CATEGORY_ANSWERS.has(compact)) return true;
  if (/^a (friend|neighbor|neighbour)['’]s /.test(norm)) return true;
  if (
    compact.startsWith('ともだちの') ||
    compact.startsWith('おともだちの') ||
    compact.startsWith('きんじょの')
  ) {
    return true;
  }
  return false;
}

/**
 * Merge chip answers + childName into the roster.
 *
 * - The STAR (starCharacterId when set, else the main_child role) gets childName
 *   (namedVia 'childName') — applied LAST so the setup sheet always wins for the star.
 * - Each answered naming question joins on characterId. A generic-category
 *   answer ("Family friend") refines the ROLE and never sets a name; a
 *   child-vocabulary answer ("Grandma", "Our dog", free-typed names) becomes
 *   the name with namedVia 'chip'. Both count as consumed.
 * - A failed join is NEVER guessed at: after a photo removal the person the
 *   chip asked about may be gone entirely, and landing their name on some
 *   other unnamed character would misname a keepsake — the one unforgivable
 *   failure. The answer stays unconsumed and survives as a confirmedFacts
 *   line; the character stays unnamed (relationship-term fallback in the
 *   prompt). Id drift across DRAFT refreshes is prevented at the source by
 *   the perception prompt's priorCharacters hint.
 */
export function mergeCastNames<T extends MergeableCharacter>(input: {
  characters: T[];
  captureQuestions: CaptureAnswerLike[] | null | undefined;
  childName: string | null | undefined;
  /**
   * X17 A2: perception characterId the parent picked as the star. When set
   * (and still in the roster), childName binds to THIS character instead of
   * the main_child role guess — the wrong-sibling fix. Stale/absent ids fall
   * back to main_child, so pre-X17 callers are byte-identical.
   */
  starCharacterId?: string | null;
}): MergeCastResult<T> {
  const characters = input.characters.map((c) => ({ ...c }));
  const consumedQuestionIds: string[] = [];
  let changed = false;

  const starTarget =
    (input.starCharacterId
      ? characters.find((c) => c.characterId === input.starCharacterId)
      : undefined) ?? characters.find((c) => c.role === 'main_child');

  const applyAnswer = (target: T, rawAnswer: string): void => {
    const answer = rawAnswer.trim();
    // Generic-category answers ("Family friend") refine a PERSON's role. For a
    // companion object every typed answer IS the name — a toy can be called
    // anything, and objects have no relationship role to refine.
    if (target.role !== 'companion_object' && isGenericCategoryAnswer(answer)) {
      const refinedRole = /[a-z]/i.test(answer) ? answer.toLowerCase() : answer;
      if (target.role !== refinedRole) {
        target.role = refinedRole;
        changed = true;
      }
      return;
    }
    if (target.name !== answer || target.namedVia !== 'chip') {
      target.name = answer;
      target.namedVia = 'chip';
      changed = true;
    }
  };

  const answered = (input.captureQuestions ?? []).filter((q) => {
    const a = q.answer?.trim();
    return !!q.characterId && !!a && a !== SKIP_SENTINEL;
  });

  for (const q of answered) {
    const target = characters.find((c) => c.characterId === q.characterId);
    // A failed join, and a naming answer pointing at the STAR (whose name
    // comes from the setup sheet), are both left unconsumed.
    if (target && target !== starTarget) {
      applyAnswer(target, q.answer!);
      consumedQuestionIds.push(q.id);
    }
  }

  const childName = input.childName?.trim();
  if (childName && starTarget) {
    if (starTarget.name !== childName || starTarget.namedVia !== 'childName') {
      starTarget.name = childName;
      starTarget.namedVia = 'childName';
      changed = true;
    }
  }

  return { characters, changed, consumedQuestionIds };
}

/** A merged roster entry as stored on Book.characterIdentity (Json). */
export type MergedCastCharacter = RawCastCharacter & { namedVia?: NamedVia };

export interface ResolvedCastEntry extends ResolvedCastMember {
  namedVia?: NamedVia;
}

/**
 * resolveCastForStory (per-character partial remap onto the current page
 * order), with name provenance carried through so the prompt and the
 * coverage check can tell parent-confirmed names from role fallbacks.
 */
export function resolveCastEntries(
  characters: MergedCastCharacter[],
  currentOrderedAssetIds: (string | null)[],
): ResolvedCastEntry[] {
  return characters.flatMap((c) =>
    resolveCastForStory([c], currentOrderedAssetIds).map((resolved) => ({
      ...resolved,
      namedVia: c.namedVia,
    })),
  );
}

// ---------------------------------------------------------------------------
// castNameCoverage — LOG-ONLY deterministic QC check
// ---------------------------------------------------------------------------

/** The cast-entry shape the coverage check needs. */
export interface CoverageCastEntry {
  name: string;
  role: string;
  namedVia?: NamedVia;
  /** 1-based current page positions; empty = pages unknown (check the whole book). */
  appearsOnPages: number[];
}

export interface CastCoverageResult {
  /** Parent-confirmed entries (namedVia chip/childName) whose script made them checkable. */
  checked: number;
  /** How many of the checked entries appear by name within ±1 page of an appearance. */
  covered: number;
  /** Names of checked-but-uncovered entries (for the QC log line). */
  missing: string[];
  /** Confirmed-named entries skipped by the script gate (kanji / cross-script). */
  skippedScript: number;
}

// Same normalization contract as story-check's deterministic checks.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"“”‘’«»„…—–\-()[\]{}、。！？「」『』・〜ー]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameMatches(name: string, pageText: string): boolean {
  const cleanName = normalize(name);
  if (!cleanName) return false;
  const page = normalize(pageText);
  const latin = /[A-Za-zÀ-ɏ]/.test(cleanName);
  return latin
    ? ` ${page} `.includes(` ${cleanName} `)
    : page.replace(/ /g, '').includes(cleanName.replace(/ /g, ''));
}

/**
 * Does every parent-confirmed name actually land in the text, on a page its
 * character is on (±1-page tolerance — introductions and callbacks legally
 * spill over)? Page-less entries (photos changed mid-setup) are checked
 * against the whole book. Script-gated exactly like the childName check:
 * kanji or cross-script names can never pass a raw substring check, so they
 * are skipped, not failed.
 *
 * LOG-ONLY by design: results feed the story-QC log line, never `problems`.
 */
export function checkCastNameCoverage(
  cast: CoverageCastEntry[],
  pageTexts: string[],
  language: string = 'en',
): CastCoverageResult {
  const result: CastCoverageResult = { checked: 0, covered: 0, missing: [], skippedScript: 0 };

  for (const entry of cast) {
    if (entry.namedVia !== 'chip' && entry.namedVia !== 'childName') continue;
    if (!entry.name?.trim()) continue;
    if (!isChildNameCheckable(entry.name, language)) {
      result.skippedScript += 1;
      continue;
    }

    let pageIndexes: number[];
    if (entry.appearsOnPages.length === 0) {
      pageIndexes = pageTexts.map((_, i) => i);
    } else {
      const windowed = new Set<number>();
      for (const p of entry.appearsOnPages) {
        for (const candidate of [p - 1, p, p + 1]) {
          const index = candidate - 1; // pages are 1-based
          if (index >= 0 && index < pageTexts.length) windowed.add(index);
        }
      }
      pageIndexes = [...windowed];
    }

    result.checked += 1;
    const covered = pageIndexes.some((i) => nameMatches(entry.name, pageTexts[i]));
    if (covered) result.covered += 1;
    else result.missing.push(entry.name);
  }

  return result;
}
