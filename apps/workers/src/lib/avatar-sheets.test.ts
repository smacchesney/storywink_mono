import { describe, it, expect } from 'vitest';
import { pickRenditionSheet, mergeSheetRefs } from './avatar-sheets.js';

describe('pickRenditionSheet', () => {
  const ready = { status: 'READY', turnaroundSheetUrl: 'https://x/ready.png' };
  const pendingWithSheet = { status: 'PENDING', turnaroundSheetUrl: 'https://x/old.png' };
  const pendingBare = { status: 'PENDING', turnaroundSheetUrl: null };

  it('READY always wins, for both book types', () => {
    expect(pickRenditionSheet([pendingWithSheet, ready], 'AVATAR_STORY')).toBe('https://x/ready.png');
    expect(pickRenditionSheet([pendingWithSheet, ready], 'PHOTO_STORY')).toBe('https://x/ready.png');
  });

  it('a mid-redraw leftover sheet anchors AVATAR_STORY books only', () => {
    // Avatar-story re-renders have no other anchor — the last good sheet holds.
    expect(pickRenditionSheet([pendingWithSheet], 'AVATAR_STORY')).toBe('https://x/old.png');
    // Photo books (X6c) stay READY-only: a stale sheet is worse than none.
    expect(pickRenditionSheet([pendingWithSheet], 'PHOTO_STORY')).toBeNull();
    expect(pickRenditionSheet([pendingWithSheet], null)).toBeNull();
  });

  it('no sheet anywhere → null', () => {
    expect(pickRenditionSheet([pendingBare], 'AVATAR_STORY')).toBeNull();
    expect(pickRenditionSheet([], 'AVATAR_STORY')).toBeNull();
  });
});

describe('mergeSheetRefs', () => {
  const avatarRef = { characterId: 'avatar_1', name: 'Emma', url: 'https://x/avatar.png' };
  const bookRefSame = { characterId: 'avatar_1', name: null, url: 'https://x/book.png' };
  const bookRefOther = { characterId: 'child_2', name: 'Zoe', url: 'https://x/zoe.png' };

  it('avatar refs lead and override same-id base refs', () => {
    expect(mergeSheetRefs([avatarRef], [bookRefSame, bookRefOther])).toEqual([
      avatarRef,
      bookRefOther,
    ]);
  });

  it('tolerates an absent base', () => {
    expect(mergeSheetRefs([avatarRef], undefined)).toEqual([avatarRef]);
  });
});
