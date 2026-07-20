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

/** A name bind skipped because another character already owns the name. */
export interface SkippedDuplicateName {
  /** The character whose bind was skipped. */
  characterId: string;
  name: string;
  claimedByCharacterId: string;
  source: 'chip' | 'childName';
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
  /**
   * Hard invariant — no duplicate names across the roster; every skipped
   * second bind lands here for the call-site log. A bind (chip or childName)
   * that would collide with a name already owned by another character is
   * dropped and reported here instead.
   */
  skippedDuplicates: SkippedDuplicateName[];
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
  // Role-category tokens (often stored underscore-joined, e.g. "parent_or_uncle").
  // Normalized `_` → space below, so match the spaced form here.
  'parent or uncle',
  'uncle or parent',
  'main child',
  'sibling',
  'cousin',
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
  // Underscore tokens ("parent_or_uncle") are role words, not names —
  // normalize `_` → space BEFORE the checks so they match the category set.
  const norm = answer.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
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
 * Merge chip answers + childName into the roster. Precedence: chips > childName
 * > relationship-word fallback. Chips are the parent's explicit per-person word,
 * so they outrank the setup sheet's single childName field — including on the
 * star target (the X17.2 "two-Kais" fix).
 *
 * - Chip answers apply to EVERY joined target, including the star. A generic-
 *   category answer ("Family friend", "parent_or_uncle") refines the ROLE and
 *   never sets a name; a child-vocabulary answer ("Grandma", "Our dog", free-
 *   typed names) becomes the name with namedVia 'chip'. Both count as consumed.
 * - childName binds to the star ONLY when the star has no chip name AND the
 *   name isn't already chip-claimed by another character.
 * - Hard invariant: no duplicate names across the roster. Any second bind of an
 *   already-claimed name (chip or childName) is skipped and reported in
 *   `skippedDuplicates`; a skipped chip stays unconsumed so it survives as a
 *   confirmedFacts line.
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
  const skippedDuplicates: SkippedDuplicateName[] = [];
  let changed = false;

  const normName = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
  // X17.2 hard invariant: one owner per name. Seed with names already
  // chip-confirmed on the stored roster (idempotent re-runs must not flag
  // a character's own persisted name as a duplicate).
  const claimedBy = new Map<string, T>();
  for (const c of characters) {
    if (c.name?.trim() && c.namedVia === 'chip') claimedBy.set(normName(c.name), c);
  }

  const starTarget =
    (input.starCharacterId
      ? characters.find((c) => c.characterId === input.starCharacterId)
      : undefined) ?? characters.find((c) => c.role === 'main_child');

  const applyAnswer = (target: T, rawAnswer: string, questionId: string): void => {
    const answer = rawAnswer.trim();
    // Generic-category / role-word answers refine a PERSON's role, never name
    // them (companion objects excepted — any word can be a toy's name).
    if (target.role !== 'companion_object' && isGenericCategoryAnswer(answer)) {
      const refinedRole = (/[a-z]/i.test(answer) ? answer.toLowerCase() : answer).replace(
        /_/g,
        ' ',
      );
      if (target.role !== refinedRole) {
        target.role = refinedRole;
        changed = true;
      }
      consumedQuestionIds.push(questionId);
      return;
    }
    const key = normName(answer);
    const holder = claimedBy.get(key);
    if (holder && holder !== target) {
      // Second bind of a claimed name: skipped + reported, answer stays
      // unconsumed so it survives as a confirmedFacts line (never dropped).
      skippedDuplicates.push({
        characterId: target.characterId,
        name: answer,
        claimedByCharacterId: holder.characterId,
        source: 'chip',
      });
      return;
    }
    if (target.name !== answer || target.namedVia !== 'chip') {
      target.name = answer;
      target.namedVia = 'chip';
      changed = true;
    }
    claimedBy.set(key, target);
    consumedQuestionIds.push(questionId);
  };

  const answered = (input.captureQuestions ?? []).filter((q) => {
    const a = q.answer?.trim();
    return !!q.characterId && !!a && a !== SKIP_SENTINEL;
  });

  // X17.2 P0a: chips apply to EVERY joined target — including the star.
  // A failed join is still never guessed at (answer survives as a fact).
  for (const q of answered) {
    const target = characters.find((c) => c.characterId === q.characterId);
    if (target) applyAnswer(target, q.answer!, q.id);
  }

  // childName binds ONLY when the star is chip-unnamed AND the name is not
  // already chip-claimed elsewhere — the setup sheet's single field never
  // overrules the parent's explicit per-person answers (the two-Kais fix).
  const childName = input.childName?.trim();
  if (childName && starTarget) {
    const holder = claimedBy.get(normName(childName));
    // ORDER MATTERS (verification fix): the claimed-elsewhere check runs FIRST
    // so the two-Kais shape reports the ACTUAL claim holder (child_2), which
    // the dump-replay test asserts — and so exactly ONE skip is reported even
    // when the star is also chip-named.
    if (holder && holder !== starTarget) {
      skippedDuplicates.push({
        characterId: starTarget.characterId,
        name: childName,
        claimedByCharacterId: holder.characterId,
        source: 'childName',
      });
    } else if (starTarget.namedVia === 'chip' && starTarget.name?.trim()) {
      // Chip won on the star itself; report only when the names actually differ.
      if (normName(starTarget.name) !== normName(childName)) {
        skippedDuplicates.push({
          characterId: starTarget.characterId,
          name: childName,
          claimedByCharacterId: starTarget.characterId,
          source: 'childName',
        });
      }
    } else if (starTarget.name !== childName || starTarget.namedVia !== 'childName') {
      starTarget.name = childName;
      starTarget.namedVia = 'childName';
      changed = true;
    }
  }

  return { characters, changed, consumedQuestionIds, skippedDuplicates };
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

export interface CastBalanceEntry {
  name: string;
  role: string;
  /** Pages whose text mentions the name; null when the script gate makes the name un-checkable. */
  textPages: number | null;
  /** Expected presence: distinct photo pages this member appears on (0 = pages unknown). */
  photoPages: number;
}

/**
 * X17 A2 castBalance — LOG-FIRST QC dimension (never `problems`). Per
 * parent-confirmed named member: how many pages actually mention them vs how
 * many photos they are in. Rides StoryQcResult.scores via the telemetry
 * object; enforcement waits for Wave C ledger evidence, per house pattern.
 */
export function computeCastBalance(
  cast: CoverageCastEntry[],
  pageTexts: string[],
  language: string = 'en',
): CastBalanceEntry[] {
  const entries: CastBalanceEntry[] = [];
  for (const member of cast) {
    if (member.namedVia !== 'chip' && member.namedVia !== 'childName') continue;
    if (!member.name?.trim()) continue;
    const checkable = isChildNameCheckable(member.name, language);
    entries.push({
      name: member.name,
      role: member.role,
      textPages: checkable
        ? pageTexts.filter((text) => nameMatches(member.name, text)).length
        : null,
      photoPages: new Set(member.appearsOnPages).size,
    });
  }
  return entries;
}

export interface CastPageConflict {
  pageNumber: number;
  name: string;
  issue: string;
}

/**
 * X17.2 P2b — the inverse of coverage: a parent-confirmed name on a page
 * its character is NOT on (±1 tolerance). Page-local by construction, so
 * the QC loop routes these to targeted single-page rewrites instead of
 * whole-book regens. Page-less entries (photos changed mid-setup) are
 * never flagged; script-gated like every deterministic name check.
 */
export function checkCastPageConflicts(
  cast: CoverageCastEntry[],
  pageTexts: string[],
  language: string = 'en',
): CastPageConflict[] {
  const conflicts: CastPageConflict[] = [];
  for (const entry of cast) {
    if (entry.namedVia !== 'chip' && entry.namedVia !== 'childName') continue;
    if (!entry.name?.trim()) continue;
    if (entry.appearsOnPages.length === 0) continue;
    if (!isChildNameCheckable(entry.name, language)) continue;
    const allowed = new Set<number>();
    for (const p of entry.appearsOnPages) {
      for (const c of [p - 1, p, p + 1]) if (c >= 1 && c <= pageTexts.length) allowed.add(c);
    }
    pageTexts.forEach((text, i) => {
      const pageNumber = i + 1;
      if (allowed.has(pageNumber)) return;
      if (nameMatches(entry.name, text)) {
        conflicts.push({
          pageNumber,
          name: entry.name,
          issue: `Page ${pageNumber} has ${entry.name} speaking or acting, but ${entry.name} is not in this page's photo (they appear on page(s) ${entry.appearsOnPages.join(', ')}). Rewrite the page without them, keeping its beat.`,
        });
      }
    });
  }
  return conflicts;
}
