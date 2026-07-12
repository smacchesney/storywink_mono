import { describe, it, expect } from 'vitest';
import {
  castComposition,
  buildAvatarStoryRoster,
  sharedReadyStyles,
  MAX_CAST_PEOPLE,
  MAX_CAST_COMPANIONS,
} from './avatar-story';

describe('castComposition', () => {
  it('allows up to 4 people plus 2 companions', () => {
    expect(castComposition(['CHILD', 'ADULT', 'ADULT', 'CHILD', 'PET', 'TOY']).ok).toBe(true);
  });

  it('rejects a 5th person and a 3rd companion', () => {
    expect(castComposition(['CHILD', 'ADULT', 'ADULT', 'ADULT', 'ADULT']).ok).toBe(false);
    expect(castComposition(['CHILD', 'PET', 'PET', 'TOY']).ok).toBe(false);
  });

  it('rejects an empty cast', () => {
    expect(castComposition([]).ok).toBe(false);
  });

  it('exports the caps the UI mirrors', () => {
    expect(MAX_CAST_PEOPLE).toBe(4);
    expect(MAX_CAST_COMPANIONS).toBe(2);
  });
});

describe('buildAvatarStoryRoster', () => {
  const emma = {
    id: 'a1',
    displayName: 'Emma',
    kind: 'CHILD' as const,
    identity: {
      physicalTraits: { hairColor: 'brown', apparentAge: '3 years' },
      typicalClothing: 'striped tee',
      styleTranslation: 'soft pencil',
    },
  };
  const grandma = { id: 'a2', displayName: 'Grandma', kind: 'ADULT' as const, identity: null };
  const biscuit = { id: 'a3', displayName: 'Biscuit', kind: 'PET' as const, identity: null };

  it('mints avatar_N ids in pick order and stars the first CHILD', () => {
    const { characters, childName } = buildAvatarStoryRoster([grandma, emma, biscuit]);
    expect(characters.map(c => c.characterId)).toEqual(['avatar_1', 'avatar_2', 'avatar_3']);
    expect(characters[1].role).toBe('main_child');
    expect(characters[1].namedVia).toBe('childName');
    expect(characters[0].role).toBe('grown-up');
    expect(characters[0].namedVia).toBe('chip');
    expect(characters[2].role).toBe('pet');
    expect(childName).toBe('Emma');
  });

  it('a second child stays a supporting child', () => {
    const zoe = { ...emma, id: 'a4', displayName: 'Zoe' };
    const { characters } = buildAvatarStoryRoster([emma, zoe]);
    expect(characters[0].role).toBe('main_child');
    expect(characters[1].role).toBe('child');
  });

  it('carries identity fields and fills gaps with sheet-pointing placeholders', () => {
    const { characters } = buildAvatarStoryRoster([emma, grandma]);
    expect(characters[0].physicalTraits.hairColor).toBe('brown');
    expect(characters[0].typicalClothing).toBe('striped tee');
    expect(characters[1].physicalTraits.hairColor).toBe('as shown on the character sheet');
    expect(characters[1].physicalTraits.apparentAge).toBe('adult');
    expect(characters[1].styleTranslation).toBe('');
  });

  it('no CHILD in cast → childName null, nobody starred', () => {
    const { characters, childName } = buildAvatarStoryRoster([grandma, biscuit]);
    expect(childName).toBeNull();
    expect(characters.every(c => c.role !== 'main_child')).toBe(true);
  });

  it('roster enters page-less', () => {
    const { characters } = buildAvatarStoryRoster([emma]);
    expect(characters[0].appearsOnPages).toEqual([]);
    expect(characters[0].appearsOnAssetIds).toEqual([]);
  });
});

describe('sharedReadyStyles', () => {
  const rendition = (artStyle: string, status = 'READY', turnaroundSheetUrl: string | null = 'https://x/sheet.png') => ({
    artStyle,
    status,
    turnaroundSheetUrl,
  });

  it('intersects READY styles across the cast', () => {
    expect(
      sharedReadyStyles([
        { renditions: [rendition('vignette'), rendition('kawaii')] },
        { renditions: [rendition('vignette')] },
      ]),
    ).toEqual(['vignette']);
  });

  it('ignores PENDING and sheet-less renditions', () => {
    expect(
      sharedReadyStyles([
        { renditions: [rendition('vignette', 'PENDING'), rendition('kawaii')] },
        { renditions: [rendition('kawaii'), rendition('vignette', 'READY', null)] },
      ]),
    ).toEqual(['kawaii']);
  });

  it('empty intersection and empty cast are honest', () => {
    expect(
      sharedReadyStyles([{ renditions: [rendition('vignette')] }, { renditions: [rendition('kawaii')] }]),
    ).toEqual([]);
    expect(sharedReadyStyles([])).toEqual([]);
  });
});
