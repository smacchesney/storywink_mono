import { describe, it, expect } from 'vitest';
import { createIllustrationPrompt } from './illustration.js';
import type { CharacterIdentity } from '../types.js';

// buildCharacterIdentitySection is not exported, so we exercise it through the
// public createIllustrationPrompt assembler (which appends the section).
const characterIdentity: CharacterIdentity = {
  sceneContext: 'A sunny backyard.',
  characters: [
    {
      characterId: 'child_1',
      role: 'main_child',
      name: 'Aria',
      physicalTraits: {
        apparentAge: '4 years old',
        hairColor: 'chestnut-brown',
        hairStyle: 'shoulder-length with a fringe',
        skinTone: 'warm-olive',
        bodyBuild: 'small and slight',
        distinguishingFeatures: ['a small freckle by her nose'],
      },
      typicalClothing: 'a red polka-dot dress',
      styleTranslation: 'rendered with soft pencil hatching and warm graphite tones',
      appearsOnPages: [3],
    },
    {
      characterId: 'adult_1',
      role: 'parent',
      name: 'Ben',
      physicalTraits: {
        apparentAge: '35 years old',
        hairColor: 'jet-black',
        hairStyle: 'short and tidy',
        skinTone: 'deep-brown',
        bodyBuild: 'tall and broad',
        distinguishingFeatures: ['round glasses'],
      },
      typicalClothing: 'a blue flannel shirt',
      styleTranslation: 'rendered with bold ink outlines',
      appearsOnPages: [5],
    },
  ],
};

describe('createIllustrationPrompt character identity section', () => {
  const prompt = createIllustrationPrompt({
    style: 'vignette',
    pageText: 'Aria spun in the sunshine.',
    bookTitle: "Aria's Big Day",
    isTitlePage: false,
    referenceImageCount: 1,
    characterIdentity,
    pageNumber: 3, // only character A (child_1) appears here
  });

  it("includes the appearing character's physical traits", () => {
    expect(prompt).toContain('chestnut-brown'); // hairColor
    expect(prompt).toContain('warm-olive'); // skinTone
  });

  it("includes the appearing character's style translation", () => {
    expect(prompt).toContain('rendered with soft pencil hatching and warm graphite tones');
  });

  it("names the appearing character", () => {
    expect(prompt).toContain('Aria');
  });

  it('excludes a character who does not appear on the current page', () => {
    // Ben (adult_1) only appears on page 5, so none of his traits should leak in.
    expect(prompt).not.toContain('jet-black');
    expect(prompt).not.toContain('deep-brown');
    expect(prompt).not.toContain('rendered with bold ink outlines');
  });

  it('demands canonical consistency across pages', () => {
    expect(prompt).toContain('CHARACTER IDENTITY');
    expect(prompt).toContain('MANDATORY');
    expect(prompt).toMatch(/MUST match these exact descriptions across ALL pages/i);
  });
});
