import { describe, it, expect } from 'vitest';
import { createIllustrationPrompt, IllustrationPromptOptions } from './illustration.js';
import { speciesLineFor, kindFromRole } from './character-identity.js';
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

  it('binds each sheet to its named character in sent order (A4 name map)', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      characterSheetCount: 2,
      bridgeScene: scene,
      sheetRoster: [
        { name: 'Kai', species: 'a young boy' },
        { name: 'Trapjaw', species: 'a toy dinosaur' },
        { name: 'Grypho', species: 'a green toy crocodile' },
      ],
    });
    // The role line still names the sheets by range, then binds each by name.
    expect(prompt).toContain('images 1-3 are CHARACTER SHEETS');
    expect(prompt).toContain('image 1 = Kai, a young boy');
    expect(prompt).toContain('image 2 = Trapjaw, a toy dinosaur');
    expect(prompt).toContain('image 3 = Grypho, a green toy crocodile');
    // The order Kai → Trapjaw → Grypho must be preserved in the rendered map.
    expect(prompt.indexOf('image 1 = Kai')).toBeLessThan(prompt.indexOf('image 2 = Trapjaw'));
    expect(prompt.indexOf('image 2 = Trapjaw')).toBeLessThan(prompt.indexOf('image 3 = Grypho'));
    // And it tells the model not to swap identities between sheets.
    expect(prompt).toMatch(/never swap identities/i);
  });

  it('a roster character with an explicit species renders that phrase in the name map', () => {
    // End-to-end over the worker's exact composition: a stored species label
    // short-circuits speciesLineFor and lands verbatim in the binding — the
    // whole point of threading species through buildAvatarStoryRoster.
    const grypho = {
      characterId: 'avatar_2',
      role: 'companion_object',
      species: 'toy crocodile',
      physicalTraits: { distinguishingFeatures: ['green fabric'] },
      typicalClothing: 'none',
    };
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      characterSheetCount: 1,
      bridgeScene: { ...scene, charactersPresent: ['avatar_1', 'avatar_2'] },
      sheetRoster: [
        {
          name: 'Emma',
          species: speciesLineFor(identity.characters[0], kindFromRole('main_child')),
        },
        { name: 'Grypho', species: speciesLineFor(grypho, kindFromRole(grypho.role)) },
      ],
    });
    expect(prompt).toContain('image 1 = Emma, a person');
    expect(prompt).toContain('image 2 = Grypho, a toy crocodile');
  });

  it('renders a single-sheet name map (image 1 = …) when only the star rides', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      characterSheetCount: 0,
      bridgeScene: scene,
      sheetRoster: [{ name: 'Emma', species: 'a young girl' }],
    });
    expect(prompt).toContain('image 1 is a CHARACTER SHEET');
    expect(prompt).toContain('image 1 = Emma, a young girl');
  });

  it('omits the name map entirely when no sheetRoster is supplied (byte-identical legacy line)', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      characterSheetCount: 2,
      bridgeScene: scene,
    });
    expect(prompt).toContain('images 1-3 are CHARACTER SHEETS');
    expect(prompt).not.toMatch(/image 1 = /);
    expect(prompt).not.toMatch(/never swap identities/i);
  });

  it('drops the name map (does not misbind) when the roster length disagrees with the sheet count', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'sheet',
      characterSheetCount: 2, // sheetTotal = 3
      bridgeScene: scene,
      sheetRoster: [{ name: 'Kai', species: 'a young boy' }], // only 1 — mismatch
    });
    expect(prompt).toContain('images 1-3 are CHARACTER SHEETS');
    expect(prompt).not.toMatch(/image 1 = /);
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
