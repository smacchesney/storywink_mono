import { describe, it, expect } from 'vitest';
import { createIllustrationPrompt, IllustrationPromptOptions } from './illustration.js';
import type { CharacterIdentity } from '../types.js';

const identity: CharacterIdentity = {
  sceneContext: '',
  characters: [
    {
      characterId: 'avatar_1',
      role: 'main_child',
      name: 'Emma',
      physicalTraits: {
        apparentAge: '3 years',
        hairColor: 'brown',
        hairStyle: 'curly bob',
        skinTone: 'warm light',
        bodyBuild: 'toddler',
        distinguishingFeatures: [],
      },
      typicalClothing: 'yellow raincoat',
      styleTranslation: 'soft pencil lines',
      appearsOnPages: [],
    },
  ],
};

const baseOpts: IllustrationPromptOptions = {
  style: 'vignette',
  pageText: 'Drip, drop! Emma tiptoes to the gate.',
  bookTitle: 'The Rainy Rescue',
  isTitlePage: false,
  referenceImageCount: 2,
  characterIdentity: identity,
  pageNumber: 3,
  language: 'en',
};

const scene = {
  location: 'the rainy garden',
  timeOfDay: 'morning',
  action: 'tiptoeing to the gate under one umbrella',
  charactersPresent: ['avatar_1'],
  props: ['red umbrella'],
};

describe('createIllustrationPrompt — sheet anchor (avatar story pages)', () => {
  it('labels image 1 as a character sheet and folds extra sheets into the range', () => {
    const single = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      characterSheetCount: 0,
      bridgeScene: scene,
    });
    expect(single).toContain('image 1 is a CHARACTER SHEET');
    expect(single).toContain('it is NOT a scene to copy');

    const multi = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      characterSheetCount: 2,
      bridgeScene: scene,
    });
    expect(multi).toContain('images 1-3 are CHARACTER SHEETS');
  });

  it('emits the avatar scene section as instructions, not caption labels', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      bridgeScene: scene,
    });
    expect(prompt).toContain('AVATAR STORY PAGE — THIS BOOK HAS NO PHOTOS');
    expect(prompt).toContain('Compose this moment: tiptoeing to the gate under one umbrella.');
    expect(prompt).toContain('Set the scene in the rainy garden, at morning.');
    expect(prompt).toContain('The following objects should appear in the scene: red umbrella.');
    // the old colon-prefixed field labels rendered literally as a caption — gone
    expect(prompt).not.toContain('DEPICT THIS MOMENT');
    expect(prompt).not.toContain('Include these objects');
    expect(prompt).not.toContain('BRIDGE PAGE —');
  });

  it('falls back to the page text (framed as the moment to depict) when the scene failed validation', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      bridgeScene: null,
    });
    expect(prompt).toContain(
      'Compose the moment this page\'s story text describes (the moment to depict, not caption copy): "Drip, drop! Emma tiptoes to the gate."',
    );
    expect(prompt).not.toContain('DEPICT the moment');
  });

  it('lists the exact cast so each character is drawn once and no strays are added', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      bridgeScene: scene,
    });
    expect(prompt).toContain(
      "Draw EXACTLY these characters, each exactly once and no more: Emma. Do not duplicate any character. Do not add any other people, animals, or creatures unless this scene's objects call for them.",
    );
  });

  it('omits the exact-cast constraint on establishing shots with no present cast', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      bridgeScene: { ...scene, charactersPresent: [] },
    });
    expect(prompt).not.toContain('Draw EXACTLY these characters');
  });

  it('closes the interior prompt with the ABSOLUTELY NO TEXT rule as its final section', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      bridgeScene: scene,
    });
    expect(prompt).toContain(
      'ABSOLUTELY NO TEXT: Do not render any letters, words, numbers, captions, labels, speech bubbles, sound effects, or title text anywhere in the image. This is a wordless illustration.',
    );
    expect(prompt.endsWith('This is a wordless illustration.')).toBe(true);
  });

  it('switches the identity arbitration to the sheets', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      bridgeScene: scene,
    });
    expect(prompt).toContain(
      'clothing follow the CHARACTER SHEETS; pose and scene composition follow the AVATAR STORY PAGE instructions',
    );
    expect(prompt).toContain(
      'Typical clothing (the CHARACTER SHEET takes precedence): yellow raincoat',
    );
  });

  it('an empty scene cast (establishing shot) drops the identity section instead of asserting the whole roster', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      bridgeScene: { ...scene, charactersPresent: [] },
    });
    expect(prompt).not.toContain('CHARACTER IDENTITY (canonical reference');
    expect(prompt).not.toContain('Emma (main_child)');
    expect(prompt).toContain('NO characters appear — paint the setting only');
  });
});

describe('createIllustrationPrompt — interior anchor (avatar story covers)', () => {
  it('labels image 1 as the approved interior render and adds the cover-anchor section', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      isTitlePage: true,
      contentAnchor: 'interior',
      characterSheetCount: 1,
    });
    expect(prompt).toContain(
      "image 1 is this book's approved interior illustration of this same scene",
    );
    expect(prompt).toContain('COVER ANCHOR');
    expect(prompt).toContain('repaint the SAME scene, people, and palette as a cover composition');
    // covers render a bounded title — the interior no-text rule must not apply
    expect(prompt).not.toContain('ABSOLUTELY NO TEXT');
  });
});

describe('createIllustrationPrompt — photo path stays byte-identical', () => {
  it('default options produce the legacy image-ordering line', () => {
    const prompt = createIllustrationPrompt({ ...baseOpts, characterIdentity: null });
    expect(prompt).toContain(
      'using the 3 images provided. The first image shows the scene/subjects, the following 2 image(s) show the artistic style to apply.',
    );
    expect(prompt).not.toContain('AVATAR STORY PAGE');
    expect(prompt).not.toContain('COVER ANCHOR');
  });
});
