import { describe, it, expect } from 'vitest';
import type { CharacterDescription, CharacterReferenceEntry } from '@storywink/shared/types';
import {
  characterPhotoCount,
  selectSheetCharacters,
  sheetCapFor,
  parseCharacterReferences,
  upsertCharacterReference,
  sheetRefsForStyle,
  resolveCharacterPhotoUrls,
  sheetSubjectKind,
  subjectAnchorFor,
  SHEET_BUDGET_MS,
  SHEET_BUDGET_MS_ENSEMBLE,
  MAX_SHEET_GENERATIONS_PER_BOOK,
  MAX_SHEET_GENERATIONS_PER_BOOK_ENSEMBLE,
  MAX_SHEETS_PER_BOOK_ENSEMBLE,
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

const member = (id: string, role: string, assets: string[]) =>
  ({
    characterId: id,
    role,
    name: null,
    appearsOnPages: assets.map((_, i) => i + 1),
    appearsOnAssetIds: assets,
  }) as unknown as CharacterDescription;

describe('ensemble sheet selection (X17 A3)', () => {
  const crew = [
    member('child_1', 'main_child', ['a1', 'a2']),
    member('child_2', 'sibling', ['a1', 'a2', 'a3']),
    member('adult_1', 'grandparent', ['a2']),
    member('pet_1', 'pet', ['a3', 'a4']),
    member('friend_9', 'friend', []),
  ];

  it('selects members with photos, prioritized by photo count, capped at 4', () => {
    const ids = selectSheetCharacters(crew, [
      'child_1',
      'child_2',
      'adult_1',
      'pet_1',
      'friend_9',
    ]).map((c) => c.characterId);
    expect(ids).toEqual(['child_2', 'child_1', 'pet_1', 'adult_1']);
  });

  it('non-members never get ensemble sheets', () => {
    expect(selectSheetCharacters(crew, ['child_1', 'pet_1']).map((c) => c.characterId)).toEqual([
      'child_1',
      'pet_1',
    ]);
  });

  it('null/absent memberIds keeps the solo path byte-identical (main + best other)', () => {
    expect(selectSheetCharacters(crew)).toEqual(selectSheetCharacters(crew, null));
    expect(selectSheetCharacters(crew).map((c) => c.characterId)).toEqual(['child_1', 'child_2']);
  });

  it('sheetCapFor: 4 for ensemble, 2 otherwise', () => {
    expect(sheetCapFor(['a', 'b'])).toBe(4);
    expect(sheetCapFor(null)).toBe(2);
    expect(sheetCapFor(undefined)).toBe(2);
  });
});

describe('X17.2 P3 — ensemble sheet budget', () => {
  it('raises the ensemble wall clock to 240s and attempts to 8', () => {
    expect(SHEET_BUDGET_MS_ENSEMBLE).toBe(240_000);
    expect(MAX_SHEET_GENERATIONS_PER_BOOK_ENSEMBLE).toBe(8);
  });
  it('solo numbers untouched', () => {
    expect(SHEET_BUDGET_MS).toBe(60_000);
    expect(MAX_SHEET_GENERATIONS_PER_BOOK).toBe(3);
    expect(MAX_SHEETS_PER_BOOK_ENSEMBLE).toBe(4);
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

describe('sheetSubjectKind (X16 W1)', () => {
  it('keeps children on the default so existing child sheets stay byte-identical', () => {
    expect(sheetSubjectKind('main_child')).toBe('child');
    expect(sheetSubjectKind('friend')).toBe('child');
    expect(sheetSubjectKind(undefined)).toBe('child');
    expect(sheetSubjectKind(null)).toBe('child');
  });

  it('maps clearly-adult roles to grown-up (never kindFromRole "person")', () => {
    expect(sheetSubjectKind('parent')).toBe('grown-up');
    expect(sheetSubjectKind('grandparent')).toBe('grown-up');
    expect(sheetSubjectKind('adult')).toBe('grown-up');
  });

  it('maps pets and companion objects', () => {
    expect(sheetSubjectKind('pet')).toBe('pet');
    expect(sheetSubjectKind('companion_object')).toBe('toy');
  });
});

describe('subjectAnchorFor (X16 W1)', () => {
  it('distills a one-line anchor from the canonical traits', () => {
    const anchor = subjectAnchorFor(
      makeCharacter({
        physicalTraits: {
          apparentAge: 'woman in her 60s',
          hairColor: 'silver',
          hairStyle: 'short',
          skinTone: 'fair',
          bodyBuild: 'slim',
          distinguishingFeatures: ['round glasses', 'floral scarf'],
        },
      }),
    );
    expect(anchor).toBe(
      'the woman in her 60s with silver short hair (round glasses, floral scarf)',
    );
  });

  it('returns null when there are no traits', () => {
    expect(subjectAnchorFor({ physicalTraits: null })).toBeNull();
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
