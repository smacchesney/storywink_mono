import { describe, it, expect } from 'vitest';
import {
  scopeCaptureQuestions,
  createPhotoAnalysisPrompt,
  PHOTO_ANALYSIS_RESPONSE_SCHEMA,
  heroAssetIds,
  CaptureQuestion,
  ScopeCharacterLike,
  PhotoAnalysisInput,
} from './photo-analysis.js';

const q = (overrides: Partial<CaptureQuestion>): CaptureQuestion => ({
  id: 'q1',
  question: 'Who is this?',
  options: ['Grandma', 'Auntie'],
  characterId: null,
  ...overrides,
});

const character = (overrides: Partial<ScopeCharacterLike>): ScopeCharacterLike => ({
  characterId: 'adult_1',
  role: 'grandparent',
  name: null,
  appearsOnPages: [1, 3],
  ...overrides,
});

const mainChild = character({
  characterId: 'child_1',
  role: 'main_child',
  appearsOnPages: [1, 2, 3, 4],
});

describe('scopeCaptureQuestions', () => {
  it('keeps a naming question for an unnamed character recurring with the child', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1', characterId: 'adult_1' })],
      [mainChild, character({})],
    );
    expect(result.map((x) => x.id)).toEqual(['q1']);
  });

  it('drops naming questions for one-photo passersby', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1', characterId: 'adult_1' })],
      [mainChild, character({ appearsOnPages: [3] })],
    );
    expect(result).toEqual([]);
  });

  it('drops naming questions for background strangers who never share a photo with the child', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1', characterId: 'adult_1' })],
      [
        character({ characterId: 'child_1', role: 'main_child', appearsOnPages: [1, 2] }),
        character({ appearsOnPages: [3, 4] }), // recurs, but never with the child
      ],
    );
    expect(result).toEqual([]);
  });

  it('drops naming questions for already-named characters, unknown ids, and the main child', () => {
    const result = scopeCaptureQuestions(
      [
        q({ id: 'q1', characterId: 'adult_1' }), // already named
        q({ id: 'q2', characterId: 'ghost_9' }), // not in roster
        q({ id: 'q3', characterId: 'child_1' }), // the child is named on the sheet
      ],
      [mainChild, character({ name: 'Grandma' })],
    );
    expect(result).toEqual([]);
  });

  it('keeps one naming question per character (first wins)', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1', characterId: 'adult_1' }), q({ id: 'q2', characterId: 'adult_1' })],
      [mainChild, character({})],
    );
    expect(result.map((x) => x.id)).toEqual(['q1']);
  });

  it('covers pets: an unnamed recurring pet sharing photos with the child qualifies', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1', characterId: 'pet_1', options: ['Our dog', "Grandma's dog"] })],
      [mainChild, character({ characterId: 'pet_1', role: 'pet', appearsOnPages: [2, 4] })],
    );
    expect(result.map((x) => x.id)).toEqual(['q1']);
  });

  it('sorts naming questions first and caps them at 2 of the 3 slots', () => {
    const result = scopeCaptureQuestions(
      [
        q({ id: 'highlight' }),
        q({ id: 'n1', characterId: 'adult_1' }),
        q({ id: 'n2', characterId: 'adult_2' }),
        q({ id: 'n3', characterId: 'pet_1' }),
      ],
      [
        mainChild,
        character({}),
        character({ characterId: 'adult_2', role: 'parent' }),
        character({ characterId: 'pet_1', role: 'pet' }),
      ],
    );
    // Two naming slots, then the highlight question survives.
    expect(result.map((x) => x.id)).toEqual(['n1', 'n2', 'highlight']);
  });

  it('lets overflow naming questions refill trailing slots when no other kinds exist', () => {
    const result = scopeCaptureQuestions(
      [
        q({ id: 'n1', characterId: 'adult_1' }),
        q({ id: 'n2', characterId: 'adult_2' }),
        q({ id: 'n3', characterId: 'pet_1' }),
      ],
      [
        mainChild,
        character({}),
        character({ characterId: 'adult_2', role: 'parent' }),
        character({ characterId: 'pet_1', role: 'pet' }),
      ],
    );
    expect(result.map((x) => x.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('caps the total at 3 questions', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1' }), q({ id: 'q2' }), q({ id: 'q3' }), q({ id: 'q4' })],
      [mainChild],
    );
    expect(result.map((x) => x.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('drops all naming questions when the roster has no main child (cannot verify scoping)', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'n1', characterId: 'adult_1' }), q({ id: 'other' })],
      [character({})],
    );
    expect(result.map((x) => x.id)).toEqual(['other']);
  });
});

describe('perception species + foreground (X16 W1)', () => {
  // photo-analysis.test.ts has no prompt-builder fixture (it covers
  // scopeCaptureQuestions only) — build a minimal PhotoAnalysisInput inline,
  // satisfying exactly the required fields of the interface.
  const minimalInput = (): PhotoAnalysisInput => ({
    childName: null,
    additionalCharacters: null,
    artStyle: 'vignette',
    language: 'en',
    storyPages: [{ pageNumber: 1, assetId: 'a1', imageUrl: 'http://x/1.jpg' }],
  });

  it('prompt asks for species and isForeground', () => {
    const prompt = createPhotoAnalysisPrompt(minimalInput());
    expect(prompt).toContain('species');
    expect(prompt).toContain('isForeground');
  });

  it('schema requires them on character entries', () => {
    const charItems = PHOTO_ANALYSIS_RESPONSE_SCHEMA.properties.characters.items;
    expect(charItems.properties.species).toBeDefined();
    expect(charItems.properties.isForeground).toBeDefined();
    expect(charItems.required as readonly string[]).toContain('species');
    expect(charItems.required as readonly string[]).toContain('isForeground');
  });
});

describe('scopeCaptureQuestions — companion objects', () => {
  const bunny = character({
    characterId: 'object_1',
    role: 'companion_object',
    appearsOnPages: [1, 2],
  });

  it('keeps an object question when its roster entry qualifies', () => {
    const result = scopeCaptureQuestions(
      [
        q({ id: 'q1', characterId: 'adult_1', kind: 'naming' }),
        q({ id: 'q2', characterId: 'object_1', kind: 'object', options: [] }),
        q({ id: 'q3', kind: 'other' }),
      ],
      [mainChild, character({}), bunny],
    );
    expect(result.map((x) => x.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('people naming outranks the object question inside the naming cap', () => {
    const result = scopeCaptureQuestions(
      [
        q({ id: 'q1', characterId: 'object_1', kind: 'object', options: [] }),
        q({ id: 'q2', characterId: 'adult_1', kind: 'naming' }),
        q({ id: 'q3', characterId: 'adult_2', kind: 'naming' }),
        q({ id: 'q4', kind: 'other' }),
      ],
      [
        mainChild,
        character({}),
        character({ characterId: 'adult_2', role: 'aunt', appearsOnPages: [2, 3] }),
        bunny,
      ],
    );
    // 2 people-naming take both naming slots; object question drops; other survives.
    expect(result.map((x) => x.id)).toEqual(['q2', 'q3', 'q4']);
  });

  it('drops an object question for a one-photo object', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1', characterId: 'object_1', kind: 'object', options: [] })],
      [mainChild, character({ ...bunny, appearsOnPages: [2] })],
    );
    expect(result).toEqual([]);
  });

  it('drops an object question when the object never shares a photo with the child', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1', characterId: 'object_1', kind: 'object', options: [] })],
      [
        character({ characterId: 'child_1', role: 'main_child', appearsOnPages: [1, 2] }),
        character({ ...bunny, appearsOnPages: [7, 8] }),
      ],
    );
    expect(result).toEqual([]);
  });
});

describe('perception theme + cover heroes (X17 A4)', () => {
  // Local copy of the X16 species describe's block-scoped minimalInput.
  const minimalInput = (): PhotoAnalysisInput => ({
    childName: null,
    additionalCharacters: null,
    artStyle: 'vignette',
    language: 'en',
    storyPages: [{ pageNumber: 1, assetId: 'a1', imageUrl: 'http://x/1.jpg' }],
  });

  it('prompt asks for suggestedTheme, coverHeroPages, and a theme-aligned title', () => {
    const prompt = createPhotoAnalysisPrompt(minimalInput());
    expect(prompt).toContain('suggestedTheme');
    expect(prompt).toContain('coverHeroPages');
    expect(prompt).toContain('aligned with the theme');
  });

  it('schema requires both at top level', () => {
    const props = PHOTO_ANALYSIS_RESPONSE_SCHEMA.properties as Record<string, unknown>;
    expect(props.suggestedTheme).toBeDefined();
    expect(props.coverHeroPages).toBeDefined();
    expect(PHOTO_ANALYSIS_RESPONSE_SCHEMA.required).toContain('suggestedTheme');
    expect(PHOTO_ANALYSIS_RESPONSE_SCHEMA.required).toContain('coverHeroPages');
  });
});

describe('heroAssetIds (X17 A4)', () => {
  const byPos = new Map<number, string | null>([
    [1, 'a1'],
    [2, 'a2'],
    [3, null],
    [4, 'a4'],
    [5, 'a5'],
  ]);
  it('maps positions to assetIds, preserving order, dropping unknowns/nulls', () => {
    expect(heroAssetIds([4, 3, 1, 99], byPos)).toEqual(['a4', 'a1']);
  });
  it('dedupes and caps at 3', () => {
    expect(heroAssetIds([1, 1, 2, 4, 5], byPos)).toEqual(['a1', 'a2', 'a4']);
  });
  it('absent → empty', () => {
    expect(heroAssetIds(undefined, byPos)).toEqual([]);
  });
});
