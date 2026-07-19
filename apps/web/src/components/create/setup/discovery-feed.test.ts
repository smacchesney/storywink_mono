import { describe, it, expect } from 'vitest';
import {
  buildDiscoveryChips,
  describeCharacter,
  recurringChildren,
  MAX_DISCOVERY_CHIPS,
  type AnalyzedPageLike,
  type RosterCharacterLike,
} from './discovery-feed';

const page = (setting: string, eventSignals: string[] = []): AnalyzedPageLike => ({
  assetId: 'a',
  analysis: { setting, action: 'x', emotion: 'y', eventSignals },
});

const kid = (id: string, pages: number[], name: string | null = null): RosterCharacterLike => ({
  characterId: id,
  role: 'main_child',
  name,
  appearsOnPages: pages,
  physicalTraits: { hairColor: 'brown', distinguishingFeatures: ['red cap'] },
});

describe('recurringChildren', () => {
  it('keeps child roles seen in 2+ photos', () => {
    const chars: RosterCharacterLike[] = [
      kid('child_1', [1, 2, 3]),
      { ...kid('child_2', [4]), role: 'sibling' },
      { characterId: 'adult_1', role: 'parent', appearsOnPages: [1, 2] },
      { ...kid('child_3', [2, 5]), role: 'friend' },
    ];
    expect(recurringChildren(chars).map((c) => c.characterId)).toEqual(['child_1', 'child_3']);
  });
});

describe('describeCharacter', () => {
  it('prefers name, then species, then role + trait, capped at 5 words', () => {
    expect(describeCharacter(kid('c1', [1], 'Leo'))).toBe('Leo');
    expect(
      describeCharacter({ characterId: 'p1', role: 'pet', species: 'golden retriever dog' }),
    ).toBe('a golden retriever dog');
    expect(describeCharacter(kid('c1', [1]))).toBe('a little one with red');
    expect(describeCharacter({ characterId: 'a1', role: 'grandparent' })).toBe('a grandparent');
  });
});

describe('buildDiscoveryChips', () => {
  it('interleaves setting/cast/signal and caps at 6', () => {
    const pages = [
      page('the beach', ['sandcastle', 'ice cream']),
      page('the beach', ['sandcastle']),
      page('a pier cafe', ['ice cream']),
      page('the dunes', []),
    ];
    const chars = [kid('child_1', [1, 2], 'Maya'), kid('child_2', [1, 3]), kid('child_3', [2, 4])];
    const chips = buildDiscoveryChips(pages, chars);
    expect(chips.length).toBeLessThanOrEqual(MAX_DISCOVERY_CHIPS);
    expect(chips.map((c) => c.kind)).toEqual([
      'setting',
      'cast',
      'cast',
      'signal',
      'setting',
      'cast',
    ]);
    expect(chips[0].label).toBe('the beach');
    expect(chips[1].label).toBe('Maya');
    expect(chips[3].label).toBe('sandcastle');
  });

  it('skips unanalyzed pages and dedupes settings case-insensitively', () => {
    const pages: AnalyzedPageLike[] = [
      { assetId: 'a', analysis: null },
      page('The Beach'),
      page('the beach'),
    ];
    const chips = buildDiscoveryChips(pages, []);
    expect(chips).toEqual([{ id: 'setting-0', kind: 'setting', label: 'The Beach' }]);
  });

  it('returns [] with no analysis at all', () => {
    expect(buildDiscoveryChips([{ assetId: 'a' }], [])).toEqual([]);
  });
});
