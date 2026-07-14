/**
 * Pure routing decision for the create chooser's character path (X8), plus the
 * "star" pick that names the personalized card. Kept free of React/fetch/Prisma
 * imports so it stays unit-testable — and so the chooser never hand-rolls the
 * usable-avatar filter, which must match the shelf's READY gate.
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
 * the same gate the shelf and wizard apply before offering a character.
 */
export function isUsableAvatar(avatar: AvatarLike): boolean {
  return avatar.status === 'READY' && avatar.renditions.some((r) => r.status === 'READY');
}

/**
 * How a cast tile presents in the wizard (X11 B3). `selectable` iff the avatar
 * is usable; otherwise `drawing` — an in-flight character the parent must wait
 * on. Only called on avatars the grid keeps (usable OR still drawing), so the
 * two states cover every rendered tile and "why won't it select" answers
 * itself with a twinkle + label.
 */
export function castTileState(avatar: AvatarLike): 'selectable' | 'drawing' {
  return isUsableAvatar(avatar) ? 'selectable' : 'drawing';
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
 * type so the caller keeps `displayName`.
 */
export function pickStar<T extends StarLike>(avatars: T[]): T | null {
  const usable = avatars.filter(isUsableAvatar);
  return usable.find((a) => a.kind === 'CHILD') ?? usable[0] ?? null;
}
