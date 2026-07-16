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

/**
 * The whole cast (people + pets + toys) shares one ceiling. It is a technical
 * bound, not a taste one: the illustration flow feeds ONE character sheet per
 * cast member into every page render (illustration-generation.worker fetches
 * each sheet with no slice cap), so cast size is the model's identity-reference
 * count. Six keeps that budget within a proven range and matches both the
 * create-route schema (avatarIds.max(6)) and MAX_BATCH_SUBJECTS. Below the
 * ceiling the parent decides the mix — no people cap, no companion cap, no
 * person-required floor.
 */
export const MAX_CAST = 6;

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
    // One character is enough and six is the most: any mix in between is the
    // parent's to choose. A pets-only or toys-only cast is a valid story now.
    ok: kinds.length >= 1 && kinds.length <= MAX_CAST,
  };
}

/**
 * Cap-guard for auto-selecting a character the parent created THIS SESSION
 * once its drawing lands (X11 B4). Returns true only when adding `avatar`
 * keeps the RESULTING cast within the total ceiling (MAX_CAST) and it is not
 * already in the cast. A full cast returns false and stays silent: the tile
 * pops to selectable and the parent chooses who to swap in.
 */
export function autoSelectAfterCreate(
  cast: { id: string; kind: CastKind }[],
  avatar: { id: string; kind: CastKind },
): boolean {
  if (cast.some((c) => c.id === avatar.id)) return false;
  return castComposition([...cast.map((c) => c.kind), avatar.kind]).ok;
}

/**
 * When the cast step's live-arrival polling session started. The 240s cap is
 * keyed to the SET of drawing avatar ids, not to pending-count-hits-zero: a NEW
 * id appearing restamps the clock, so one wedged rendition never starves a
 * character the parent creates afterwards. Every drawing settling resets to
 * null (next drawing starts fresh); the same set continuing keeps the running
 * start so the cap can actually expire.
 */
export function nextArrivalPollStart(
  prevDrawingIds: ReadonlySet<string>,
  drawingIds: ReadonlySet<string>,
  startedAt: number | null,
  now: number,
): number | null {
  if (drawingIds.size === 0) return null;
  if (startedAt === null) return now;
  const hasNewDrawing = Array.from(drawingIds).some((id) => !prevDrawingIds.has(id));
  return hasNewDrawing ? now : startedAt;
}

/** The loose CharacterDescription-shaped character fields the roster reads. */
export interface StoredAvatarCharacter {
  /** Extraction-provided "what is this" label ("toy crocodile") — additive,
   *  absent on identities from before the field existed. */
  species?: string | null;
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

/**
 * The JSON stored on Avatar.identity. CANONICAL shape — written by every
 * production path (extractAvatarIdentity, buildIdentityFromDetection, the
 * promote route) — NESTS the character: { character: {...},
 * extractedForStyle }. A legacy/flat identity is the character object itself;
 * unwrapStoredIdentity tolerates both. Never read character fields off this
 * wrapper directly.
 */
export interface StoredAvatarIdentity extends StoredAvatarCharacter {
  character?: StoredAvatarCharacter | null;
  extractedForStyle?: string;
}

/** Nested canonical → the character; legacy flat → the identity itself. */
function unwrapStoredIdentity(identity: StoredAvatarIdentity | null): StoredAvatarCharacter | null {
  return identity?.character ?? identity;
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
  /** Carried from Avatar.identity so the illustration worker's sheet
   *  name-map (speciesLineFor) can short-circuit on the explicit label. */
  species: string | null;
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
    // Unwrap ONCE: the stored identity nests the character (legacy flat
    // tolerated). Reading fields off the wrapper silently yields undefined —
    // exactly the bug that shipped placeholder-only rosters.
    const ident = unwrapStoredIdentity(avatar.identity);
    const traits = ident?.physicalTraits ?? {};
    return {
      characterId: `avatar_${i + 1}`,
      role: isStar ? 'main_child' : KIND_ROLE_FALLBACK[avatar.kind],
      name: avatar.displayName,
      namedVia: (isStar ? 'childName' : 'chip') as 'chip' | 'childName',
      species: ident?.species?.trim() || null,
      physicalTraits: {
        apparentAge: traits.apparentAge?.trim() || KIND_AGE_FALLBACK[avatar.kind],
        hairColor: traits.hairColor?.trim() || 'as shown on the character sheet',
        hairStyle: traits.hairStyle?.trim() || 'as shown on the character sheet',
        skinTone: traits.skinTone?.trim() || 'as shown on the character sheet',
        bodyBuild: traits.bodyBuild?.trim() || 'as shown on the character sheet',
        distinguishingFeatures: traits.distinguishingFeatures ?? [],
      },
      typicalClothing: ident?.typicalClothing?.trim() || 'as shown on the character sheet',
      styleTranslation: ident?.styleTranslation?.trim() || '',
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
