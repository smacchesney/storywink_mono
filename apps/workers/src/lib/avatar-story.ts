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
