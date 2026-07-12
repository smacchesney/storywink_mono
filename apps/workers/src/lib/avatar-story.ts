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
    .map(c => ({
      characterId: c.characterId,
      name: c.name,
      role: c.role?.trim() || 'grown-up',
      description: describeCastMember(c),
    }));
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
    charactersPresent: parsed.data.charactersPresent.filter(id => roster.has(id)),
  };
}
