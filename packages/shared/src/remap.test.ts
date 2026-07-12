import { describe, it, expect } from 'vitest';
import { remapCharacterPages } from './utils.js';

const identity = (
  chars: { appearsOnPages: number[]; appearsOnAssetIds?: (string | null)[] }[],
) => ({
  characters: chars,
});

describe('remapCharacterPages', () => {
  it('maps creation-order positions to the current order after a reorder', () => {
    // Creation order: a1, a2, a3. Character appeared on photos 2 and 3.
    const id = identity([{ appearsOnPages: [2, 3], appearsOnAssetIds: ['a2', 'a3'] }]);
    // Parent reordered to: a3, a1, a2.
    const result = remapCharacterPages(id, ['a3', 'a1', 'a2']);
    expect(result?.characters[0].appearsOnPages).toEqual([1, 3]);
  });

  it('is the identity mapping when order is unchanged', () => {
    const id = identity([{ appearsOnPages: [1, 3], appearsOnAssetIds: ['a1', 'a3'] }]);
    const result = remapCharacterPages(id, ['a1', 'a2', 'a3']);
    expect(result?.characters[0].appearsOnPages).toEqual([1, 3]);
  });

  it('returns null for legacy identities without assetId stamps', () => {
    const id = identity([{ appearsOnPages: [1, 2] }]);
    expect(remapCharacterPages(id, ['a1', 'a2'])).toBeNull();
  });

  it('returns null when a referenced photo was swapped out', () => {
    const id = identity([{ appearsOnPages: [1, 2], appearsOnAssetIds: ['a1', 'a2'] }]);
    expect(remapCharacterPages(id, ['a1', 'aNEW'])).toBeNull();
  });

  it('dedupes and sorts pages, skipping null asset stamps', () => {
    const id = identity([
      { appearsOnPages: [3, 1, 3], appearsOnAssetIds: ['a3', 'a1', 'a3', null] },
    ]);
    const result = remapCharacterPages(id, ['a2', 'a3', 'a1']);
    expect(result?.characters[0].appearsOnPages).toEqual([2, 3]);
  });

  it('fails the whole identity if ANY character is unmappable', () => {
    const id = identity([
      { appearsOnPages: [1], appearsOnAssetIds: ['a1'] },
      { appearsOnPages: [2], appearsOnAssetIds: ['gone'] },
    ]);
    expect(remapCharacterPages(id, ['a1', 'a2'])).toBeNull();
  });
});
