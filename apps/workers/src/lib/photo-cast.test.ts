import { describe, it, expect } from 'vitest';
import { photoPresentCharacterIds, PhotoCastMember } from './photo-cast.js';

const member = (over: Partial<PhotoCastMember> & { characterId: string }): PhotoCastMember => ({
  appearsOnPages: [],
  ...over,
});

describe('photoPresentCharacterIds', () => {
  it('matches on the asset stamp (reorder-proof: ignores stale page numbers)', () => {
    // appearsOnPages says page 9, but the parent reordered so the asset now
    // sits on page 3. The stamp — not the stale positional page — decides.
    const roster = [
      member({ characterId: 'child_1', appearsOnAssetIds: ['asset-a'], appearsOnPages: [9] }),
      member({ characterId: 'adult_1', appearsOnAssetIds: ['asset-b'], appearsOnPages: [9] }),
    ];
    expect(photoPresentCharacterIds(roster, 'asset-a', 3)).toEqual(['child_1']);
  });

  it('keeps every character whose stamp is on the page', () => {
    const roster = [
      member({ characterId: 'child_1', appearsOnAssetIds: ['asset-a'] }),
      member({ characterId: 'dog_1', appearsOnAssetIds: ['asset-a', 'asset-c'] }),
      member({ characterId: 'adult_1', appearsOnAssetIds: ['asset-b'] }),
    ];
    expect(photoPresentCharacterIds(roster, 'asset-a', 1)).toEqual(['child_1', 'dog_1']);
  });

  it('falls back to appearsOnPages when the character has no asset stamps (legacy roster)', () => {
    const roster = [
      member({ characterId: 'child_1', appearsOnPages: [2, 4] }),
      member({ characterId: 'adult_1', appearsOnPages: [5] }),
    ];
    expect(photoPresentCharacterIds(roster, 'asset-a', 4)).toEqual(['child_1']);
  });

  it('falls back to appearsOnPages when the page carries no assetId (e.g. null)', () => {
    const roster = [
      member({ characterId: 'child_1', appearsOnAssetIds: ['asset-a'], appearsOnPages: [3] }),
    ];
    expect(photoPresentCharacterIds(roster, null, 3)).toEqual(['child_1']);
    // With no assetId AND no page match, nothing is present.
    expect(photoPresentCharacterIds(roster, null, 9)).toEqual([]);
  });

  it('treats null entries inside appearsOnAssetIds as non-matches', () => {
    const roster = [member({ characterId: 'child_1', appearsOnAssetIds: [null, 'asset-a'] })];
    expect(photoPresentCharacterIds(roster, 'asset-a', 1)).toEqual(['child_1']);
    expect(
      photoPresentCharacterIds(
        [member({ characterId: 'x', appearsOnAssetIds: [null] })],
        'asset-a',
        1,
      ),
    ).toEqual([]);
  });

  it('returns [] (fail-open signal) when nothing matches or the roster is empty/absent', () => {
    const roster = [
      member({ characterId: 'child_1', appearsOnAssetIds: ['asset-a'], appearsOnPages: [1] }),
    ];
    expect(photoPresentCharacterIds(roster, 'asset-z', 9)).toEqual([]);
    expect(photoPresentCharacterIds([], 'asset-a', 1)).toEqual([]);
    expect(photoPresentCharacterIds(null, 'asset-a', 1)).toEqual([]);
    expect(photoPresentCharacterIds(undefined, 'asset-a', 1)).toEqual([]);
  });
});
