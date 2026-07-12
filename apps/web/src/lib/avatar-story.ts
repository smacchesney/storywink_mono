/**
 * Avatar-story (X6d) pure helpers for the create route and the cast picker.
 *
 * The cast becomes a per-book roster: characterIds are minted in pick order
 * (avatar_1, avatar_2, ...), the first CHILD is the star (main_child), and
 * each avatar's stored identity (CharacterDescription shape) is composed into
 * Book.characterIdentity so the story and illustration pipelines consume it
 * unchanged. Dependency-free per the repo's pure-helper testing convention.
 */

export const AVATAR_STORY_PAGE_LENGTHS = [8, 12, 16] as const;
export type AvatarStoryPageLength = (typeof AVATAR_STORY_PAGE_LENGTHS)[number];

/** ≤4 people; pets & toys ride extra object slots (≤2). */
export const MAX_CAST_PEOPLE = 4;
export const MAX_CAST_COMPANIONS = 2;

export type CastKind = 'CHILD' | 'ADULT' | 'PET' | 'TOY';

export interface CastComposition {
  people: number;
  companions: number;
  ok: boolean;
}

export function castComposition(kinds: CastKind[]): CastComposition {
  const people = kinds.filter((k) => k === 'CHILD' || k === 'ADULT').length;
  const companions = kinds.length - people;
  return {
    people,
    companions,
    // At least one PERSON: the story prompt keeps pets real animals and toys
    // inanimate, so a people-less cast would have no one who can act at all.
    ok: people >= 1 && people <= MAX_CAST_PEOPLE && companions <= MAX_CAST_COMPANIONS,
  };
}

/** The loose CharacterDescription-shaped JSON stored on Avatar.identity. */
export interface StoredAvatarIdentity {
  physicalTraits?: {
    apparentAge?: string;
    hairColor?: string;
    hairStyle?: string;
    skinTone?: string;
    bodyBuild?: string;
    distinguishingFeatures?: string[];
  } | null;
  typicalClothing?: string | null;
  styleTranslation?: string | null;
  [key: string]: unknown;
}

export interface CastAvatarInput {
  id: string;
  displayName: string;
  kind: CastKind;
  identity: StoredAvatarIdentity | null;
}

export interface RosterCharacter {
  characterId: string;
  role: string;
  name: string;
  namedVia: 'chip' | 'childName';
  physicalTraits: {
    apparentAge: string;
    hairColor: string;
    hairStyle: string;
    skinTone: string;
    bodyBuild: string;
    distinguishingFeatures: string[];
  };
  typicalClothing: string;
  styleTranslation: string;
  appearsOnPages: number[];
  appearsOnAssetIds: string[];
}

const KIND_ROLE_FALLBACK: Record<CastKind, string> = {
  CHILD: 'child',
  ADULT: 'grown-up',
  PET: 'pet',
  TOY: 'companion_object',
};

const KIND_AGE_FALLBACK: Record<CastKind, string> = {
  CHILD: 'young child',
  ADULT: 'adult',
  PET: 'animal companion',
  TOY: 'beloved toy',
};

/**
 * Cast (in pick order) → per-book roster. The first CHILD is the star
 * (main_child, namedVia childName — the setup-sheet convention); everyone
 * else keeps a kind-derived role with the parent-given name (namedVia chip).
 * Identity gaps are filled with neutral placeholders so the illustration
 * identity section never renders undefined fields — the rendition sheets
 * carry the real appearance.
 */
export function buildAvatarStoryRoster(cast: CastAvatarInput[]): {
  characters: RosterCharacter[];
  childName: string | null;
} {
  const firstChildIndex = cast.findIndex((a) => a.kind === 'CHILD');
  const characters = cast.map((avatar, i) => {
    const isStar = i === firstChildIndex;
    const traits = avatar.identity?.physicalTraits ?? {};
    return {
      characterId: `avatar_${i + 1}`,
      role: isStar ? 'main_child' : KIND_ROLE_FALLBACK[avatar.kind],
      name: avatar.displayName,
      namedVia: (isStar ? 'childName' : 'chip') as 'chip' | 'childName',
      physicalTraits: {
        apparentAge: traits.apparentAge?.trim() || KIND_AGE_FALLBACK[avatar.kind],
        hairColor: traits.hairColor?.trim() || 'as shown on the character sheet',
        hairStyle: traits.hairStyle?.trim() || 'as shown on the character sheet',
        skinTone: traits.skinTone?.trim() || 'as shown on the character sheet',
        bodyBuild: traits.bodyBuild?.trim() || 'as shown on the character sheet',
        distinguishingFeatures: traits.distinguishingFeatures ?? [],
      },
      typicalClothing:
        avatar.identity?.typicalClothing?.trim() || 'as shown on the character sheet',
      styleTranslation: avatar.identity?.styleTranslation?.trim() || '',
      appearsOnPages: [],
      appearsOnAssetIds: [],
    };
  });

  return {
    characters,
    childName: firstChildIndex >= 0 ? cast[firstChildIndex].displayName : null,
  };
}

/**
 * The rendition styles every cast member shares (READY only) — the styles an
 * avatar-story can start in without drawing anyone again.
 */
export function sharedReadyStyles(
  cast: {
    renditions: { artStyle: string; status: string; turnaroundSheetUrl?: string | null }[];
  }[],
): string[] {
  if (cast.length === 0) return [];
  const perAvatar = cast.map(
    (a) =>
      new Set(
        a.renditions
          .filter((r) => r.status === 'READY' && r.turnaroundSheetUrl !== null)
          .map((r) => r.artStyle),
      ),
  );
  return Array.from(perAvatar[0]).filter((style) => perAvatar.every((set) => set.has(style)));
}
