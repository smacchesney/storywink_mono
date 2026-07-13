/**
 * Pure routing decision for the create chooser's character path (X8), plus the
 * "star" pick that names the personalized card. Kept free of React/fetch/Prisma
 * imports so it stays unit-testable — and so the chooser never hand-rolls the
 * usable-avatar filter, which must stay byte-identical to AvatarStoryCard's.
 */

export type CharacterPathDestination = '/create/characters' | '/characters?add=1';

/** Minimal structural shape — the full AvatarSummary is assignable to this. */
export interface AvatarLike {
  status: 'DRAFT' | 'READY';
  renditions: Array<{ status: 'PENDING' | 'READY' | 'FAILED' }>;
}

/** Adds the field the star pick needs; AvatarSummary is assignable to this too. */
export interface StarLike extends AvatarLike {
  kind: 'CHILD' | 'ADULT' | 'PET' | 'TOY';
}

/**
 * An avatar is usable iff it is READY and has at least one READY rendition —
 * the exact filter AvatarStoryCard applies before offering a character card.
 */
export function isUsableAvatar(avatar: AvatarLike): boolean {
  return avatar.status === 'READY' && avatar.renditions.some((r) => r.status === 'READY');
}

/**
 * ≥1 usable avatar → the story wizard (`/create/characters`); otherwise the
 * shelf with the studio auto-opened (`/characters?add=1`). Never bare
 * `/characters` — the empty account must land somewhere that invites a first
 * character, not a blank shelf.
 */
export function characterPathDestination(avatars: AvatarLike[]): CharacterPathDestination {
  return avatars.some(isUsableAvatar) ? '/create/characters' : '/characters?add=1';
}

/**
 * The face the personalized title names: the first CHILD among usable avatars,
 * else the first usable avatar, else null. Generic over the concrete avatar
 * type so the caller keeps `displayName`. Mirrors AvatarStoryCard's star pick.
 */
export function pickStar<T extends StarLike>(avatars: T[]): T | null {
  const usable = avatars.filter(isUsableAvatar);
  return usable.find((a) => a.kind === 'CHILD') ?? usable[0] ?? null;
}
