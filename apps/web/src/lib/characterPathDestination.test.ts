import { describe, it, expect } from 'vitest';
import {
  characterPathDestination,
  pickStar,
  isUsableAvatar,
  castTileState,
  type AvatarLike,
  type StarLike,
} from './characterPathDestination';

const rend = (status: 'PENDING' | 'READY' | 'FAILED') => ({ status });

/** A star fixture carries displayName so we can assert which avatar was picked. */
type Star = StarLike & { displayName: string };

describe('isUsableAvatar', () => {
  it('is true only for a READY avatar with at least one READY rendition', () => {
    expect(isUsableAvatar({ status: 'READY', renditions: [rend('READY')] })).toBe(true);
    expect(isUsableAvatar({ status: 'DRAFT', renditions: [rend('READY')] })).toBe(false);
    expect(isUsableAvatar({ status: 'READY', renditions: [rend('PENDING'), rend('FAILED')] })).toBe(
      false,
    );
    expect(isUsableAvatar({ status: 'READY', renditions: [] })).toBe(false);
  });
});

describe('castTileState', () => {
  it('is selectable only when the avatar is usable (READY + a READY rendition)', () => {
    expect(castTileState({ status: 'READY', renditions: [rend('READY')] })).toBe('selectable');
    expect(castTileState({ status: 'READY', renditions: [rend('PENDING'), rend('READY')] })).toBe(
      'selectable',
    );
  });

  it('is drawing for an in-flight avatar the parent must wait on', () => {
    // Fresh batch avatar: DRAFT status, its rendition still PENDING.
    expect(castTileState({ status: 'DRAFT', renditions: [rend('PENDING')] })).toBe('drawing');
    // READY status but no READY rendition yet — still drawing.
    expect(castTileState({ status: 'READY', renditions: [rend('PENDING')] })).toBe('drawing');
    // A DRAFT with a READY rendition is not yet usable (matches isUsableAvatar).
    expect(castTileState({ status: 'DRAFT', renditions: [rend('READY')] })).toBe('drawing');
  });
});

describe('characterPathDestination', () => {
  it('sends an empty account to the studio', () => {
    expect(characterPathDestination([])).toBe('/characters?add=1');
  });

  it('sends a DRAFT-only account to the studio', () => {
    const avatars: AvatarLike[] = [{ status: 'DRAFT', renditions: [rend('READY')] }];
    expect(characterPathDestination(avatars)).toBe('/characters?add=1');
  });

  it('sends a READY avatar with no READY rendition to the studio', () => {
    const avatars: AvatarLike[] = [
      { status: 'READY', renditions: [rend('PENDING'), rend('FAILED')] },
    ];
    expect(characterPathDestination(avatars)).toBe('/characters?add=1');
  });

  it('sends one fully usable avatar to the story wizard', () => {
    const avatars: AvatarLike[] = [{ status: 'READY', renditions: [rend('READY')] }];
    expect(characterPathDestination(avatars)).toBe('/create/characters');
  });

  it('sends a mixed account with one usable avatar to the story wizard', () => {
    const avatars: AvatarLike[] = [
      { status: 'DRAFT', renditions: [rend('READY')] },
      { status: 'READY', renditions: [rend('FAILED')] },
      { status: 'READY', renditions: [rend('PENDING'), rend('READY')] },
    ];
    expect(characterPathDestination(avatars)).toBe('/create/characters');
  });
});

describe('pickStar', () => {
  const child: Star = {
    status: 'READY',
    kind: 'CHILD',
    renditions: [rend('READY')],
    displayName: 'Mika',
  };
  const pet: Star = {
    status: 'READY',
    kind: 'PET',
    renditions: [rend('READY')],
    displayName: 'Rex',
  };

  it('returns null when no avatar is usable', () => {
    const draftChild: Star = {
      status: 'DRAFT',
      kind: 'CHILD',
      renditions: [rend('READY')],
      displayName: 'Ghost',
    };
    expect(pickStar([draftChild])).toBeNull();
  });

  it('prefers the first usable CHILD', () => {
    expect(pickStar([pet, child])?.displayName).toBe('Mika');
  });

  it('falls back to the first usable avatar when no CHILD is usable', () => {
    expect(pickStar([pet])?.displayName).toBe('Rex');
  });

  it('skips an unusable CHILD when picking', () => {
    const draftChild: Star = {
      status: 'DRAFT',
      kind: 'CHILD',
      renditions: [rend('READY')],
      displayName: 'Ghost',
    };
    expect(pickStar([draftChild, pet])?.displayName).toBe('Rex');
  });
});
