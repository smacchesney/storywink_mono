import { describe, it, expect } from 'vitest';
import {
  scopeCaptureQuestions,
  createPhotoAnalysisPrompt,
  PHOTO_ANALYSIS_RESPONSE_SCHEMA,
  PERCEPTION_ROLES,
  heroAssetIds,
  stampFaceBox,
  CaptureQuestion,
  ScopeCharacterLike,
  PhotoAnalysisInput,
  FaceBox,
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

describe('stampFaceBox (X17.2)', () => {
  const byPos = new Map<number, string | null>([
    [1, 'a1'],
    [2, 'a2'],
    [3, null],
  ]);
  const box = (): FaceBox => ({ pageNumber: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.4 });

  it('stamps the assetId behind a known position', () => {
    expect(stampFaceBox(box(), byPos)).toEqual({
      pageNumber: 2,
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
      assetId: 'a2',
    });
  });

  it('null box → null', () => {
    expect(stampFaceBox(null, byPos)).toBeNull();
  });

  it('undefined box → null', () => {
    expect(stampFaceBox(undefined, byPos)).toBeNull();
  });

  it('unknown position → box kept, assetId null', () => {
    const b = { ...box(), pageNumber: 99 };
    expect(stampFaceBox(b, byPos)).toEqual({ ...b, assetId: null });
  });

  it('bridge/photo-less position (mapped null) → assetId null', () => {
    const b = { ...box(), pageNumber: 3 };
    expect(stampFaceBox(b, byPos)).toEqual({ ...b, assetId: null });
  });

  it('never mutates its input', () => {
    const input = box();
    stampFaceBox(input, byPos);
    expect(input).toEqual({ pageNumber: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(input).not.toHaveProperty('assetId');
  });

  it('legacy character WITHOUT faceBox: only faceBox:null is added, spread untouched', () => {
    const legacyChar = {
      characterId: 'child_1',
      role: 'main_child',
      name: 'Emma',
      appearsOnPages: [1, 2],
    };
    // Mirror the worker's exact stamping expression.
    const stamped = {
      ...legacyChar,
      appearsOnAssetIds: legacyChar.appearsOnPages.map((n) => byPos.get(n) ?? null),
      faceBox: stampFaceBox((legacyChar as { faceBox?: FaceBox | null }).faceBox, byPos),
    };
    expect(stamped).toEqual({ ...legacyChar, appearsOnAssetIds: ['a1', 'a2'], faceBox: null });
  });
});

describe('X17.2 perception schema additions', () => {
  const charProps = (PHOTO_ANALYSIS_RESPONSE_SCHEMA.properties.characters.items as any).properties;
  const charRequired = (PHOTO_ANALYSIS_RESPONSE_SCHEMA.properties.characters.items as any).required;
  const pageProps = (PHOTO_ANALYSIS_RESPONSE_SCHEMA.properties.pageAnalysis.items as any)
    .properties;
  const pageRequired = (PHOTO_ANALYSIS_RESPONSE_SCHEMA.properties.pageAnalysis.items as any)
    .required;

  it('constrains role to the closed vocabulary (P0c)', () => {
    expect(charProps.role.enum).toEqual(PERCEPTION_ROLES);
    expect(PERCEPTION_ROLES).toContain('main_child');
    expect(PERCEPTION_ROLES).toContain('companion_object');
    expect(PERCEPTION_ROLES).not.toContain('parent_or_uncle');
  });

  it('requires descriptor and faceBox per character (P0d)', () => {
    expect(charRequired).toContain('descriptor');
    expect(charRequired).toContain('faceBox');
    expect(charProps.faceBox.type).toEqual(['object', 'null']);
    expect(charProps.faceBox.properties).toHaveProperty('pageNumber');
    for (const k of ['x', 'y', 'w', 'h']) expect(charProps.faceBox.properties).toHaveProperty(k);
  });

  it('requires settingChip per page', () => {
    expect(pageProps).toHaveProperty('settingChip');
    expect(pageRequired).toContain('settingChip');
  });

  it('prompt names the role vocabulary and the descriptor/faceBox rules', () => {
    const prompt = createPhotoAnalysisPrompt({
      childName: null,
      additionalCharacters: null,
      artStyle: 'vignette',
      storyPages: [{ pageNumber: 1, assetId: 'a1', imageUrl: 'http://x/1.jpg' }],
    });
    expect(prompt).toContain('role (EXACTLY one of:');
    expect(prompt).toContain('descriptor');
    expect(prompt).toContain('faceBox');
    expect(prompt).toContain('settingChip');
    expect(prompt).toContain('never invent a role outside this list');
  });
});
