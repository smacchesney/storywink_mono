import { describe, it, expect } from 'vitest';
import {
  createCharacterSheetPrompt,
  createSheetValidationPrompt,
  type SheetCharacterInput,
} from './character-identity.js';

function fixtureCharacter(overrides: Partial<SheetCharacterInput> = {}): SheetCharacterInput {
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
    styleTranslation: 'soft pencil',
    ...overrides,
  };
}

describe('sheet prompts by subject kind (X16 W1)', () => {
  it('defaults byte-identically to the child wording', () => {
    const prompt = createCharacterSheetPrompt({
      character: fixtureCharacter(),
      photoCount: 2,
      styleRefCount: 2,
      styleBible: 'STYLE',
    });
    expect(prompt).toContain('the SAME child');
  });

  it('omits the anchor sentence when no subjectAnchor is provided', () => {
    const prompt = createCharacterSheetPrompt({
      character: fixtureCharacter(),
      photoCount: 2,
      styleRefCount: 2,
      styleBible: 'STYLE',
    });
    expect(prompt).not.toContain('THE SUBJECT:');
    expect(prompt).not.toContain('Ignore every other person');
  });

  it('parameterizes non-child subjects and adds the anchor', () => {
    const prompt = createCharacterSheetPrompt({
      character: fixtureCharacter(),
      photoCount: 2,
      styleRefCount: 2,
      styleBible: 'STYLE',
      subjectKind: 'grown-up',
      subjectAnchor: 'the woman in her 60s with short silver hair and round glasses',
    });
    expect(prompt).toContain('the SAME grown-up');
    expect(prompt).toContain(
      'THE SUBJECT: the woman in her 60s with short silver hair and round glasses',
    );
    expect(prompt).toContain('Ignore every other person');
    expect(prompt).not.toContain('the SAME child');
  });

  it('validation prompt defaults byte-identically to the child wording', () => {
    const prompt = createSheetValidationPrompt({
      character: fixtureCharacter(),
      photoCount: 2,
      styleRefCount: 2,
      artStyle: 'vignette',
    });
    expect(prompt).toContain('a real child');
    expect(prompt).toContain('the SAME child');
  });

  it('parameterizes the validation prompt the same way', () => {
    const prompt = createSheetValidationPrompt({
      character: fixtureCharacter(),
      photoCount: 2,
      styleRefCount: 2,
      artStyle: 'vignette',
      subjectKind: 'pet',
    });
    expect(prompt).toContain('a real pet');
    expect(prompt).toContain('the SAME pet');
    expect(prompt).not.toContain('a real child');
    expect(prompt).not.toContain('the SAME child');
  });
});
