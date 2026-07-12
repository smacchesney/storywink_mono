import { describe, it, expect } from 'vitest';
import {
  createCharacterCutoutPrompt,
  createCutoutValidationPrompt,
  CUTOUT_VALIDATION_RESPONSE_SCHEMA,
  CUTOUT_VALIDATION_SYSTEM_PROMPT,
  type CutoutCharacterInput,
} from './character-identity.js';

const child: CutoutCharacterInput = {
  characterId: 'avatar_subject',
  role: 'main_child',
  name: 'Mia',
  physicalTraits: {
    apparentAge: '4 years old',
    hairColor: 'jet black',
    hairStyle: 'short bob with a straight fringe',
    skinTone: 'warm golden-brown',
    bodyBuild: 'small and sturdy',
    distinguishingFeatures: ['round red glasses'],
  },
  styleTranslation: 'soft watercolor with loose ink lines',
  typicalClothing: 'a yellow raincoat over a striped tee',
};

const styleBible = 'ART STYLE BIBLE: watercolor vignette.';

function promptFor(kind: string): string {
  return createCharacterCutoutPrompt({
    character: child,
    kind,
    styleRefCount: 2,
    styleBible,
  });
}

describe('createCharacterCutoutPrompt', () => {
  it('is a single-subject, full-body contract on pure white', () => {
    const prompt = promptFor('CHILD');
    expect(prompt).toContain('ONE image');
    expect(prompt).toMatch(/exactly ONE character/i);
    expect(prompt).toMatch(/full body/i);
    expect(prompt).toMatch(/feet .*visible/i);
    expect(prompt).toMatch(/PURE WHITE/);
  });

  it('people wave; the pose lines differ per kind', () => {
    expect(promptFor('CHILD')).toMatch(/waving/i);
    expect(promptFor('ADULT')).toMatch(/waving/i);
    // Pets get a happy alert greeting, not a hand wave.
    const pet = promptFor('PET');
    expect(pet).not.toMatch(/waving hello with one raised hand/i);
    expect(pet).toMatch(/tail mid-wag/i);
    // Toys sit proudly.
    expect(promptFor('TOY')).toMatch(/sitting proudly/i);
  });

  it('unknown kinds fall back to the waving-person pose', () => {
    expect(promptFor('SOMETHING_ELSE')).toMatch(/waving/i);
  });

  it('forbids grids, panels, extra views, scenery, and text', () => {
    const prompt = promptFor('CHILD');
    expect(prompt).toMatch(/no grid/i);
    expect(prompt).toMatch(/no panels/i);
    expect(prompt).toMatch(/no scenery/i);
    expect(prompt).toMatch(/no text/i);
    expect(prompt).toMatch(/no cast shadows/i);
  });

  it('anchors identity on the sheet image and keeps the canonical outfit', () => {
    const prompt = promptFor('CHILD');
    expect(prompt).toMatch(/model sheet/i);
    expect(prompt).toContain('a yellow raincoat over a striped tee');
    expect(prompt).toContain(styleBible);
    expect(prompt).toContain('round red glasses');
  });

  it('sizes the figure to fill the card (~85% of frame height)', () => {
    expect(promptFor('CHILD')).toMatch(/85%/);
  });

  it('handles a missing outfit without leaking "null" into the prompt', () => {
    const prompt = createCharacterCutoutPrompt({
      character: { ...child, typicalClothing: null },
      kind: 'PET',
      styleRefCount: 2,
      styleBible,
    });
    expect(prompt).not.toContain('null');
  });
});

describe('createCutoutValidationPrompt', () => {
  it('names the image order and the four checks', () => {
    const prompt = createCutoutValidationPrompt({
      character: child,
      kind: 'CHILD',
      styleRefCount: 2,
      artStyle: 'vignette',
    });
    expect(prompt).toMatch(/model sheet/i);
    expect(prompt).toMatch(/candidate/i);
    expect(prompt).toContain('singleFullBody');
    expect(prompt).toContain('sameCharacter');
    expect(prompt).toContain('whiteBackground');
    expect(prompt).toContain('noTextArtifacts');
    expect(prompt).toMatch(/waving/i);
  });

  it('describes the kind-appropriate pose for pets', () => {
    const prompt = createCutoutValidationPrompt({
      character: child,
      kind: 'PET',
      styleRefCount: 2,
      artStyle: 'vignette',
    });
    expect(prompt).not.toMatch(/waving/i);
    expect(prompt).toMatch(/alert|greeting/i);
  });
});

describe('CUTOUT_VALIDATION_RESPONSE_SCHEMA', () => {
  it('requires every check plus passed and notes (strict mode)', () => {
    expect(CUTOUT_VALIDATION_RESPONSE_SCHEMA.required).toEqual([
      'singleFullBody',
      'sameCharacter',
      'whiteBackground',
      'noTextArtifacts',
      'passed',
      'notes',
    ]);
    expect(CUTOUT_VALIDATION_RESPONSE_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('CUTOUT_VALIDATION_SYSTEM_PROMPT', () => {
  it('exists and reads as an art-director role', () => {
    expect(CUTOUT_VALIDATION_SYSTEM_PROMPT).toMatch(/art director/i);
  });
});
