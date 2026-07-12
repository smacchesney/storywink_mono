import { describe, it, expect } from 'vitest';
import type { CharacterDescription, CharacterReferenceEntry } from '@storywink/shared/types';
import {
  characterPhotoCount,
  selectSheetCharacters,
  parseCharacterReferences,
  upsertCharacterReference,
  sheetRefsForStyle,
  resolveCharacterPhotoUrls,
} from './character-sheets.helpers.js';

function makeCharacter(overrides: Partial<CharacterDescription>): CharacterDescription {
  return {
    characterId: 'child_1',
    role: 'main_child',
    name: 'Mia',
    physicalTraits: {
      apparentAge: '3 years old',
      hairColor: 'black',
      hairStyle: 'short curls',
      skinTone: 'warm golden-brown',
      bodyBuild: 'toddler',
      distinguishingFeatures: [],
    },
    typicalClothing: 'yellow raincoat',
    styleTranslation: 'soft pencil',
    appearsOnPages: [1, 2, 3],
    appearsOnAssetIds: ['a1', 'a2', 'a3'],
    ...overrides,
  };
}

describe('selectSheetCharacters', () => {
  it('picks main_child plus the character with the largest photo count, capped at 2', () => {
    const main = makeCharacter({ characterId: 'child_1', role: 'main_child' });
    const grandma = makeCharacter({
      characterId: 'adult_1',
      role: 'grandparent',
      appearsOnPages: [1, 2, 3, 4],
      appearsOnAssetIds: ['a1', 'a2', 'a3', 'a4'],
    });
    const friend = makeCharacter({
      characterId: 'child_2',
      role: 'friend',
      appearsOnPages: [2],
      appearsOnAssetIds: ['a2'],
    });

    const selected = selectSheetCharacters([friend, grandma, main]);
    expect(selected.map((c) => c.characterId)).toEqual(['child_1', 'adult_1']);
  });

  it('accepts roles starting with "main" (free-form role strings)', () => {
    const main = makeCharacter({ characterId: 'child_9', role: 'main character' });
    expect(selectSheetCharacters([main]).map((c) => c.characterId)).toEqual(['child_9']);
  });

  it('never drops the main child in favor of a higher photo count', () => {
    const main = makeCharacter({
      characterId: 'child_1',
      role: 'main_child',
      appearsOnPages: [1],
      appearsOnAssetIds: ['a1'],
    });
    const parent = makeCharacter({
      characterId: 'adult_1',
      role: 'parent',
      appearsOnPages: [1, 2, 3, 4, 5],
      appearsOnAssetIds: ['a1', 'a2', 'a3', 'a4', 'a5'],
    });
    const selected = selectSheetCharacters([parent, main]);
    expect(selected[0].characterId).toBe('child_1');
    expect(selected).toHaveLength(2);
  });

  it('skips characters without any resolvable photo', () => {
    const ghost = makeCharacter({
      characterId: 'adult_2',
      role: 'parent',
      appearsOnPages: [],
      appearsOnAssetIds: [],
    });
    const main = makeCharacter({ characterId: 'child_1', role: 'main_child' });
    expect(selectSheetCharacters([ghost, main]).map((c) => c.characterId)).toEqual(['child_1']);
  });

  it('falls back to appearsOnPages counting when assetId stamps are absent', () => {
    const extractionIdentityChar = makeCharacter({
      characterId: 'child_1',
      role: 'main_child',
      appearsOnAssetIds: undefined,
      appearsOnPages: [1, 2],
    });
    expect(characterPhotoCount(extractionIdentityChar)).toBe(2);
    expect(selectSheetCharacters([extractionIdentityChar])).toHaveLength(1);
  });
});

describe('characterReferences keying and reuse', () => {
  const entry = (
    characterId: string,
    artStyle: string,
    url = `https://x/${characterId}-${artStyle}.png`,
  ): CharacterReferenceEntry => ({
    characterId,
    artStyle,
    url,
    validatedAt: '2026-07-05T00:00:00.000Z',
  });

  it('parses only well-formed entries', () => {
    const parsed = parseCharacterReferences([
      entry('child_1', 'kawaii'),
      { characterId: 'broken' },
      'junk',
      null,
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].characterId).toBe('child_1');
  });

  it('returns [] for non-array json', () => {
    expect(parseCharacterReferences(null)).toEqual([]);
    expect(parseCharacterReferences({})).toEqual([]);
    expect(parseCharacterReferences(undefined)).toEqual([]);
  });

  it('upserts by (characterId, artStyle) and RETAINS other styles — A→B→A costs nothing', () => {
    let entries = [entry('child_1', 'vignette')];
    // Style flip to kawaii: new entry added, vignette retained.
    entries = upsertCharacterReference(entries, entry('child_1', 'kawaii'));
    expect(entries).toHaveLength(2);
    // Regenerating the kawaii sheet replaces only the kawaii entry.
    const fresher = entry('child_1', 'kawaii', 'https://x/child_1-kawaii-v2.png');
    entries = upsertCharacterReference(entries, fresher);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.artStyle === 'kawaii')?.url).toContain('v2');
    // Flip back to vignette: the original entry is still there.
    expect(entries.find((e) => e.artStyle === 'vignette')).toBeDefined();
  });

  it('sheetRefsForStyle filters by style and resolves names from the identity', () => {
    const refs = sheetRefsForStyle(
      [entry('child_1', 'kawaii'), entry('child_1', 'vignette'), entry('adult_1', 'kawaii')],
      'kawaii',
      {
        sceneContext: '',
        characters: [
          makeCharacter({ characterId: 'child_1', name: 'Mia' }),
          makeCharacter({ characterId: 'adult_1', name: null, role: 'grandparent' }),
        ],
      },
    );
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ characterId: 'child_1', name: 'Mia' });
    expect(refs[1]).toMatchObject({ characterId: 'adult_1', name: null });
  });

  it('sheetRefsForStyle returns [] without a style', () => {
    expect(sheetRefsForStyle([entry('child_1', 'kawaii')], null, null)).toEqual([]);
  });
});

describe('resolveCharacterPhotoUrls', () => {
  const pages = [
    {
      assetId: 'a1',
      asset: { url: 'https://res.cloudinary.com/d/image/upload/p1.jpg', thumbnailUrl: null },
    },
    {
      assetId: 'a2',
      asset: { url: null, thumbnailUrl: 'https://res.cloudinary.com/d/image/upload/p2-thumb.jpg' },
    },
    {
      assetId: 'a3',
      asset: { url: 'https://res.cloudinary.com/d/image/upload/p3.HEIC', thumbnailUrl: null },
    },
    {
      assetId: 'a4',
      asset: { url: 'https://res.cloudinary.com/d/image/upload/p4.jpg', thumbnailUrl: null },
    },
  ];

  it('resolves via appearsOnAssetIds with vision normalization and HEIC conversion', () => {
    const urls = resolveCharacterPhotoUrls(
      makeCharacter({ appearsOnAssetIds: ['a1', 'a3', null] }),
      pages,
    );
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('c_limit,w_2048,h_2048');
    expect(urls[1]).toContain('f_jpg');
  });

  it('falls back to positional appearsOnPages when stamps are absent', () => {
    const urls = resolveCharacterPhotoUrls(
      makeCharacter({ appearsOnAssetIds: undefined, appearsOnPages: [1, 2] }),
      pages,
    );
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('p2-thumb');
  });

  it('caps at the max and de-duplicates', () => {
    const urls = resolveCharacterPhotoUrls(
      makeCharacter({ appearsOnAssetIds: ['a1', 'a1', 'a2', 'a3', 'a4'] }),
      pages,
    );
    expect(urls).toHaveLength(3);
  });
});
