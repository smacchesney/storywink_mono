/**
 * Avatar-story (X6d) pure helpers for the story worker.
 *
 * AVATAR_STORY books carry their roster on Book.characterIdentity from
 * creation time (composed from the linked avatars' identities — perception
 * never runs, there are no photos). These helpers translate that stored
 * roster into the prompt cast, and validate the model's per-page scenes
 * before they are persisted to Page.bridgeScene.
 *
 * Everything here is dependency-free (no Prisma, no BullMQ) per the repo's
 * extract-pure-helper testing convention.
 */
import { avatarPageSceneSchema } from '@storywink/shared/schemas';
import type { AvatarPageScene, AvatarStoryCastMember } from '@storywink/shared/prompts/story';
import { STORY_QC_THRESHOLDS, AvatarStoryQCResponse } from '@storywink/shared/prompts/story-check';

/** The loose shape of one Book.characterIdentity roster entry (Json). */
export interface StoredRosterCharacter {
  characterId?: string;
  role?: string;
  name?: string | null;
  physicalTraits?: {
    hairColor?: string;
    distinguishingFeatures?: string[];
  } | null;
  typicalClothing?: string | null;
}

/**
 * One-line appearance note for the prompt (feeds illustrationNotes wording —
 * "the girl in the yellow raincoat"). Short and optional: identity JSONs from
 * promotion-era avatars may be sparse.
 */
export function describeCastMember(c: StoredRosterCharacter): string | undefined {
  const bits: string[] = [];
  const hair = c.physicalTraits?.hairColor?.trim();
  if (hair) bits.push(`${hair} hair`);
  const feature = c.physicalTraits?.distinguishingFeatures?.[0]?.trim();
  if (feature) bits.push(feature);
  const clothing = c.typicalClothing?.trim();
  if (clothing && clothing.toLowerCase() !== 'none') bits.push(clothing);
  const joined = bits.join(', ').slice(0, 160);
  return joined.length > 0 ? joined : undefined;
}

/**
 * Stored roster → prompt cast. Entries without a characterId or name are
 * dropped (nothing to reference scenes against / nothing to call them).
 */
export function buildAvatarCastForPrompt(
  characters: StoredRosterCharacter[] | null | undefined,
): AvatarStoryCastMember[] {
  return (characters ?? [])
    .filter((c): c is StoredRosterCharacter & { characterId: string; name: string } =>
      Boolean(c.characterId?.trim() && c.name?.trim()),
    )
    .map((c) => ({
      characterId: c.characterId,
      name: c.name,
      role: c.role?.trim() || 'grown-up',
      description: describeCastMember(c),
    }));
}

/**
 * The avatar-story QC verdict (pure, pinned by tests): which scores block the
 * draft and force the single regeneration. premiseTruth is deliberately
 * ABSENT — it ships LOG-ONLY, same telemetry-first philosophy as every other
 * new check (an enforcing check is a silent extra generation during the
 * parent's wait).
 */
export function avatarStoryQcProblems(
  qc: Pick<
    AvatarStoryQCResponse,
    'arcCoherence' | 'readAloudRhythm' | 'lastPageLanding' | 'feedback'
  >,
  refrain: string,
  refrainEchoes: number,
): string[] {
  const problems: string[] = [];
  if (refrainEchoes < STORY_QC_THRESHOLDS.minRefrainEchoes) {
    problems.push(
      `The refrain "${refrain}" is only recognizable on ${refrainEchoes} page(s). It must echo (with variation) on at least ${STORY_QC_THRESHOLDS.minRefrainEchoes} pages.`,
    );
  }
  if (qc.arcCoherence < STORY_QC_THRESHOLDS.minArcCoherence) {
    problems.push(
      `Arc coherence scored ${qc.arcCoherence}/10 — the pages must actually deliver the declared desire → escalation → peak → soft landing.`,
    );
  }
  if (qc.readAloudRhythm < STORY_QC_THRESHOLDS.minReadAloudRhythm) {
    problems.push(
      `Read-aloud rhythm scored ${qc.readAloudRhythm}/10 — vary sentence lengths and make it musical when spoken.`,
    );
  }
  if (!qc.lastPageLanding) {
    problems.push('The final page must land as a soft, warm exhale — no summary statements.');
  }
  if (problems.length > 0 && qc.feedback) {
    problems.push(qc.feedback);
  }
  return problems;
}

/**
 * Deterministic sheet order for avatar-story renders: the FIRST sheet becomes
 * image 1 (the render's content anchor). Star first when present; everyone
 * else in roster order (avatar_N is minted in pick order, so a numeric-aware
 * characterId sort IS the parent's pick order). Without this, the order is
 * whatever the DB returned — a different anchor per render.
 */
export function orderCharacterSheets<T extends { characterId: string }>(
  sheets: T[],
  starCharacterId: string | null | undefined,
): T[] {
  const byRoster = [...sheets].sort((a, b) =>
    a.characterId.localeCompare(b.characterId, 'en', { numeric: true }),
  );
  if (!starCharacterId) return byRoster;
  return [
    ...byRoster.filter((s) => s.characterId === starCharacterId),
    ...byRoster.filter((s) => s.characterId !== starCharacterId),
  ];
}

/**
 * A6: choose which character sheets ride along on ONE interior avatar page.
 * Sending every cast sheet to every page multiplied the fusion/duplication
 * surface (Trapjaw×T-Rex, two Kais); this narrows the stack to the scene's
 * cast while guarding the invariants the render depends on:
 *
 * - the star's sheet is ALWAYS present and stays image 1 (the content anchor);
 * - at most `cap` sheets total (star + up to cap-1 others), chosen in the same
 *   deterministic star-first roster order orderCharacterSheets already uses;
 * - never zero — an empty cast (a deliberate establishing shot) or a scene
 *   whose ids all miss still floors to the single anchor sheet.
 *
 * `charactersPresent: null` means the scene failed validation (no cast to
 * trust) — send every sheet, ordered, so the whole-roster identity section the
 * prompt falls back to still has its references. Ids that resolve to no sheet
 * are skipped (the same best-effort resolution the prompt's cast sections use).
 */
export function selectSceneSheets<T extends { characterId: string }>(
  sheets: T[],
  opts: {
    charactersPresent: string[] | null;
    starCharacterId: string | null | undefined;
    cap?: number;
  },
): T[] {
  const { charactersPresent, starCharacterId, cap = 4 } = opts;
  const ordered = orderCharacterSheets(sheets, starCharacterId);

  // Scene invalid → no cast to filter by; keep today's all-sheets behavior.
  if (charactersPresent === null) return ordered;

  const present = new Set(charactersPresent);
  const starSheets = starCharacterId
    ? ordered.filter((s) => s.characterId === starCharacterId)
    : [];
  const others = ordered.filter(
    (s) => s.characterId !== starCharacterId && present.has(s.characterId),
  );

  let selected = [...starSheets, ...others];
  // Floor: never zero. Fall back to the deterministic first sheet (the star
  // when it has a sheet, else roster-first) so image 1 always exists.
  if (selected.length === 0 && ordered.length > 0) selected = [ordered[0]];

  return selected.slice(0, cap);
}

/** Roster entry the scene-cast cross-check matches page text against. */
export interface SceneCastRosterMember {
  characterId: string;
  name: string;
}

/** What reconcileSceneCastWithText changed, for the repair telemetry. */
export interface SceneCastRepair {
  /** characterIds the text named that the scene had dropped (roster order). */
  addedIds: string[];
  /** The display names (roster spelling) that triggered each added id. */
  textNames: string[];
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-word test for a roster name inside page text. Mirrors the proven
 * neutral-name substitution (`substituteCharacterNames`, illustration.ts) in
 * BOTH of its guards: alphanumeric lookarounds, so "Kai" never matches inside
 * "Kaito" while a possessive ("Kai's") still matches; and capitalization-
 * preserving acceptance, so a bare-lowercase occurrence is treated as a
 * common-noun homograph, not the character — a child named "Star" must not be
 * union-added onto a page whose text only says "the falling star" (post-Track-A,
 * charactersPresent is an authoritative draw instruction AND the sheet
 * selector, and a false add is invisible to QC because expectedCastForPage
 * derives from this same repaired scene). Occurrences whose first letter is
 * uppercase ("Star", "STAR", sentence-case) count, plus the roster's exact
 * spelling (covers characterId fallbacks like "avatar_2" that are legitimately
 * lowercase). Sentence-start homographs ("Biscuit crumbs everywhere!") are an
 * accepted edge — the same one substituteCharacterNames lives with.
 */
function textNamesCharacter(text: string, name: string): boolean {
  if (!name.trim()) return false;
  const body = `(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])`;
  for (const match of text.matchAll(new RegExp(body, 'gi'))) {
    if (match[0] === name || /^\p{Lu}/u.test(match[0])) return true;
  }
  return false;
}

/**
 * B2 cross-check: `text` and `scene` are two independent outputs of the story
 * model, so a character NAMED in the page text can silently go missing from
 * `charactersPresent` — and the illustrator only ever sees the scene (Track A's
 * `selectSceneSheets` even decides WHICH reference sheets ship from this list).
 * This deterministic pass re-unites them.
 *
 * For each roster character whose name the page text names (whole-word,
 * case-insensitive), assert its id is in `charactersPresent`; AUTO-REPAIR BY
 * UNION — append any missing id, existing entries first, appended repairs in
 * roster order. UNION ONLY: ids the model included but the text does not name
 * are kept (establishing shots and background presence are legitimate).
 *
 * Pure and idempotent: a no-op returns the SAME scene reference and a null
 * repair, so the caller logs telemetry only when something actually moved.
 */
export function reconcileSceneCastWithText(
  scene: AvatarPageScene,
  text: string,
  roster: SceneCastRosterMember[],
): { scene: AvatarPageScene; repair: SceneCastRepair | null } {
  const present = new Set(scene.charactersPresent);
  const addedIds: string[] = [];
  const textNames: string[] = [];
  for (const member of roster) {
    if (present.has(member.characterId)) continue;
    if (textNamesCharacter(text, member.name)) {
      addedIds.push(member.characterId);
      textNames.push(member.name);
      present.add(member.characterId); // guard against a duplicated roster entry
    }
  }
  if (addedIds.length === 0) return { scene, repair: null };
  return {
    scene: { ...scene, charactersPresent: [...scene.charactersPresent, ...addedIds] },
    repair: { addedIds, textNames },
  };
}

/**
 * Validate-or-DEGRADE one model-emitted page scene. A malformed scene must
 * never fail the story job — the page simply renders from its text alone.
 * Unknown characterIds are dropped from charactersPresent (the illustrator
 * must never be told to draw someone who has no sheet); the scene survives.
 */
export function extractAvatarScene(
  raw: unknown,
  rosterCharacterIds: string[],
): AvatarPageScene | null {
  const parsed = avatarPageSceneSchema.safeParse(raw);
  if (!parsed.success) return null;
  const roster = new Set(rosterCharacterIds);
  return {
    ...parsed.data,
    charactersPresent: parsed.data.charactersPresent.filter((id) => roster.has(id)),
  };
}
