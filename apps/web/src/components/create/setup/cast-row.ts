/**
 * X17.2 — pure logic for the Who's-in-this-book row. Components render,
 * this module decides (strip-phase idiom). Everything derives from the
 * persisted roster + pages + captureQuestions; no fetches, no React.
 */
import type { CaptureQuestion } from './CaptureChips';
import {
  CHILD_ROLES,
  describeCharacter,
  recurringChildren,
  type RosterCharacterLike,
} from './discovery-feed';
// RELATIVE, not `@/lib/face-crop` (verification fix): this is a VALUE import
// and the root vitest config resolves no `@/` alias (vitest.config.ts aliases
// only @storywink/shared/*; see setup-submit.ts:1) — `@/` here would break
// cast-row.test.ts at module resolution.
import { faceCropUrl, faceThumbUrl } from '../../../lib/face-crop';

/**
 * Reserved row height — held from first mount. The UX-spec anatomy sum:
 * 20 (header line) + 8 (gap) + 88 (faces strip incl. name line + scroll
 * padding) + 8 (gap) + 44 (ask slot) = 168.
 */
export const CAST_RESERVE_MIN_HEIGHT = 168;

/** "Everyone!" confirmation flash in the ask slot — visible feedback, then the naming prompt. */
export const EVERYONE_FLASH_MS = 2000;

/** Star-pick twinkle burst — one wink-twinkle cycle (globals.css: 1.4s), then unmount. */
export const STAR_BURST_MS = 1400;

export type CastPhase = 'hidden' | 'reading' | 'star-ask' | 'naming';

export interface CastPageLike {
  assetId: string | null;
  asset?: { url: string | null; thumbnailUrl: string | null } | null;
}

/** Faces shown in the row: foreground people + pets, never the toy. */
export function castMembers(roster: RosterCharacterLike[]): RosterCharacterLike[] {
  const eligible = roster.filter((c) => c.isForeground !== false && c.role !== 'companion_object');
  const kids = recurringChildren(eligible).sort(
    (a, b) => (b.appearsOnPages?.length ?? 0) - (a.appearsOnPages?.length ?? 0),
  );
  const kidIds = new Set(kids.map((k) => k.characterId));
  const rest = eligible
    .filter((c) => !kidIds.has(c.characterId))
    .sort((a, b) => (b.appearsOnPages?.length ?? 0) - (a.appearsOnPages?.length ?? 0));
  return [...kids, ...rest];
}

/**
 * Face image source: faceBox crop when its asset resolves, else a g_face
 * thumb of the clearest photo (first appearsOnAssetIds hit), else null
 * (placeholder circle — NEVER a text-only chip).
 *
 * Wrong-crop safety (UX review): g_face picks a photo's MOST PROMINENT face,
 * so two members falling back on the same photo would render the identical
 * crop. Pass one `usedFallbackAssets` set per render (call in member order):
 * the fallback claims the first asset nobody holds yet and records it; when
 * every candidate is claimed it shares the first resolvable one — a shared
 * crop beats an empty circle. faceBox crops ignore the set (distinct boxes
 * on a shared photo are already distinct crops).
 */
export function castFaceSrc(
  member: RosterCharacterLike & {
    faceBox?: {
      pageNumber: number;
      x: number;
      y: number;
      w: number;
      h: number;
      assetId?: string | null;
    } | null;
    appearsOnAssetIds?: (string | null)[];
  },
  pages: CastPageLike[],
  usedFallbackAssets?: Set<string>,
): string | null {
  const urlFor = (assetId: string | null | undefined): string | null => {
    if (!assetId) return null;
    const page = pages.find((p) => p.assetId === assetId);
    return page?.asset?.url || page?.asset?.thumbnailUrl || null;
  };
  const boxUrl = urlFor(member.faceBox?.assetId);
  if (member.faceBox && boxUrl) return faceCropUrl(boxUrl, member.faceBox);
  let firstResolvable: string | null = null;
  for (const assetId of member.appearsOnAssetIds ?? []) {
    const url = urlFor(assetId);
    if (!url || !assetId) continue;
    firstResolvable = firstResolvable ?? url;
    if (!usedFallbackAssets?.has(assetId)) {
      usedFallbackAssets?.add(assetId);
      return faceThumbUrl(url);
    }
  }
  return firstResolvable ? faceThumbUrl(firstResolvable) : null;
}

export function castPhase(input: {
  members: RosterCharacterLike[];
  recurringKidCount: number;
  castMode: 'star' | 'ensemble';
  starCharacterId: string | null;
  reading: boolean;
}): CastPhase {
  if (input.members.length === 0) return input.reading ? 'reading' : 'hidden';
  if (input.recurringKidCount >= 2 && input.castMode === 'star' && input.starCharacterId === null) {
    return 'star-ask';
  }
  return 'naming';
}

/** Display-only star context for one face (never persisted anywhere). */
export interface StarDisplay {
  isStar: boolean;
  childName?: string | null;
}

/**
 * The face that carries the star glyph and the childName display: the picked
 * star, or — on books that never see a star ask — the sole recurring kid,
 * falling back to the sole kid-role face when no kid recurs. Display-only;
 * mergeCastNames precedence (Task 3) is untouched.
 */
export function displayStarId(input: {
  starCharacterId: string | null;
  castMode: 'star' | 'ensemble';
  members: RosterCharacterLike[];
}): string | null {
  if (input.castMode !== 'star') return null;
  if (input.starCharacterId) return input.starCharacterId;
  const recurring = recurringChildren(input.members);
  if (recurring.length === 1) return recurring[0].characterId;
  if (recurring.length === 0) {
    const kids = input.members.filter((m) => (CHILD_ROLES as readonly string[]).includes(m.role));
    if (kids.length === 1) return kids[0].characterId;
  }
  return null;
}

/**
 * The display name under a face — the chain deliberately mirrors merge
 * precedence (committed rows outrank childName; Task 3), so the sheet never
 * shows a name the merge would later overrule: committed answer → roster
 * name → (display star only) trimmed childName.
 */
export function memberDisplayName(
  member: RosterCharacterLike,
  questions: CaptureQuestion[],
  star?: StarDisplay,
): string | null {
  const row = questions.find((q) => q.characterId === member.characterId);
  if (row?.answer && row.answer !== '__skip__') return row.answer;
  if (member.name?.trim()) return member.name.trim();
  if (star?.isStar && star.childName?.trim()) return star.childName.trim();
  return null;
}

/** True when this face carries the quiet coral badge — nothing in the display chain resolves. */
export function needsName(
  member: RosterCharacterLike,
  questions: CaptureQuestion[],
  star?: StarDisplay,
): boolean {
  return memberDisplayName(member, questions, star) === null;
}

/** Star-pickable faces: only recurring kids may become the star (UX review). */
export function starPickableIds(members: RosterCharacterLike[]): Set<string> {
  return new Set(recurringChildren(members).map((k) => k.characterId));
}

/** Suggestion chips for the inline input: the perception question's options. */
export function memberNameOptions(
  member: RosterCharacterLike,
  questions: CaptureQuestion[],
): string[] {
  return questions.find((q) => q.characterId === member.characterId)?.options ?? [];
}

/**
 * Commit a typed name into the captureQuestions channel: reuse the member's
 * existing row (perception q*, ramble_name_*, name_*), else mint name_<id>.
 * Empty input clears the answer but keeps the row (PATCH round-trip safe).
 * Pure copy-on-write — safe inside a setForm updater.
 */
export function upsertNameAnswer(
  questions: CaptureQuestion[],
  member: RosterCharacterLike,
  rawName: string,
  questionFor: (descriptor: string) => string,
): CaptureQuestion[] {
  const value = rawName.trim().slice(0, 50) || null;
  const idx = questions.findIndex((q) => q.characterId === member.characterId);
  if (idx >= 0) {
    if (questions[idx].answer === value) return questions;
    const next = [...questions];
    next[idx] = { ...next[idx], answer: value };
    return next;
  }
  if (!value) return questions;
  return [
    ...questions,
    {
      id: `name_${member.characterId}`,
      question: questionFor(describeCharacter(member)),
      options: [],
      characterId: member.characterId,
      kind: 'naming' as const,
      answer: value,
    },
  ].slice(0, 10);
}

/** Star-ask applicability — drives the quiet "Change" affordance. */
export function starAskApplicable(recurringKidCount: number): boolean {
  return recurringKidCount >= 2;
}

export { CHILD_ROLES };
