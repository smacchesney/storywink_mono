import { describe, it, expect } from 'vitest';
import {
  buildNeutralNameMap,
  createIllustrationPrompt,
  IllustrationPromptOptions,
  substituteCharacterNames,
} from './illustration.js';
import type { CharacterIdentity } from '../types.js';

// X12-D Stage 1 fixture: an evocative-name roster (the "Grypho"→griffin
// failure class) with a name-prefix pair (Kai / Kaito) to pin word-boundary
// substitution. Star is deliberately NOT first in the roster array — the token
// map must still make the star Character 1.
const identity: CharacterIdentity = {
  sceneContext: '',
  characters: [
    {
      characterId: 'avatar_2',
      role: 'sibling',
      name: 'Kaito',
      physicalTraits: {
        apparentAge: '6 years',
        hairColor: 'black',
        hairStyle: 'short',
        skinTone: 'warm light',
        bodyBuild: 'child',
        distinguishingFeatures: [],
      },
      typicalClothing: 'green hoodie',
      styleTranslation: 'Render Kaito with soft pencil edges.',
      appearsOnPages: [],
    },
    {
      characterId: 'avatar_1',
      role: 'main_child',
      name: 'Kai',
      physicalTraits: {
        apparentAge: '3 years',
        hairColor: 'brown',
        hairStyle: 'curly bob',
        skinTone: 'warm light',
        bodyBuild: 'toddler',
        distinguishingFeatures: [],
      },
      typicalClothing: 'yellow raincoat',
      styleTranslation: 'Center Kai in the vignette.',
      appearsOnPages: [],
    },
    {
      characterId: 'avatar_3',
      role: 'companion_object',
      name: 'Grypho',
      physicalTraits: {
        apparentAge: 'n/a',
        hairColor: 'n/a',
        hairStyle: 'n/a',
        skinTone: 'n/a',
        bodyBuild: 'plush',
        distinguishingFeatures: ['black-and-orange fabric'],
      },
      typicalClothing: 'none',
      styleTranslation: 'Position Grypho at the same scale as on the sheet.',
      appearsOnPages: [],
    },
  ],
};

const scene = {
  location: 'the jungle path',
  timeOfDay: 'dusk',
  action: 'Kai hugs Kaito while Grypho naps on the mossy log',
  charactersPresent: ['avatar_1', 'avatar_2', 'avatar_3'],
  props: ["Kai's paper map", 'lantern'],
};

const baseOpts: IllustrationPromptOptions = {
  style: 'vignette',
  pageText: 'Kai tiptoes past Grypho.',
  bookTitle: 'Kai and the Wild Rumble',
  isTitlePage: false,
  referenceImageCount: 2,
  characterIdentity: identity,
  pageNumber: 4,
  language: 'en',
  contentAnchor: 'sheet',
  characterSheetCount: 2,
  bridgeScene: scene,
  sheetRoster: [
    { name: 'Kai', species: 'a young boy' },
    { name: 'Kaito', species: 'a young boy' },
    { name: 'Grypho', species: 'a black-and-orange toy crocodile' },
  ],
};

/** Whole-word presence check (no match inside longer words). */
const asWord = (name: string) => new RegExp(`(?<![A-Za-z0-9])${name}(?![A-Za-z0-9])`);

describe('buildNeutralNameMap', () => {
  it('numbers the star Character 1, then the remaining roster in array order', () => {
    expect(buildNeutralNameMap(identity)).toEqual([
      { name: 'Kai', token: 'Character 1' },
      { name: 'Kaito', token: 'Character 2' },
      { name: 'Grypho', token: 'Character 3' },
    ]);
  });

  it('falls back to characterId when a roster entry has no name, and to array order without a star', () => {
    const map = buildNeutralNameMap({
      sceneContext: '',
      characters: [
        { ...identity.characters[0], role: 'parent', name: null as unknown as string },
        { ...identity.characters[2], role: 'pet' },
      ],
    });
    expect(map).toEqual([
      { name: 'avatar_2', token: 'Character 1' },
      { name: 'Grypho', token: 'Character 2' },
    ]);
  });

  it('returns an empty map for a missing roster', () => {
    expect(buildNeutralNameMap(null)).toEqual([]);
    expect(buildNeutralNameMap(undefined)).toEqual([]);
  });
});

describe('substituteCharacterNames', () => {
  const map = buildNeutralNameMap(identity);

  it('replaces whole words only — "Kai" never matches inside "Kaito"', () => {
    expect(substituteCharacterNames('Kai hugs Kaito', map)).toBe('Character 1 hugs Character 2');
  });

  it('handles possessives and punctuation boundaries', () => {
    expect(substituteCharacterNames("Kai's map, Grypho!", map)).toBe(
      "Character 1's map, Character 3!",
    );
  });

  it('substitutes ALL-CAPS variants but leaves bare lowercase (homograph safety)', () => {
    expect(substituteCharacterNames('kai waves; GRYPHO naps', map)).toBe(
      'kai waves; Character 3 naps',
    );
  });

  it('leaves non-roster words untouched', () => {
    expect(substituteCharacterNames('The T-Rex sneezes ash', map)).toBe('The T-Rex sneezes ash');
  });

  it('is a no-op with an empty map', () => {
    expect(substituteCharacterNames('Kai hugs Kaito', [])).toBe('Kai hugs Kaito');
  });

  it('still substitutes a lowercase roster name written exactly as the roster spells it', () => {
    // buildNeutralNameMap falls back to characterId ("avatar_2") when a roster
    // entry has no display name — the exact roster spelling must substitute
    // even though its first letter is lowercase.
    expect(
      substituteCharacterNames('avatar_2 waves', [{ name: 'avatar_2', token: 'Character 1' }]),
    ).toBe('Character 1 waves');
  });
});

describe('substituteCharacterNames — homograph preservation (X12-D review fix)', () => {
  const starMap = [{ name: 'Star', token: 'Character 1' }];

  it('substitutes the capitalized name but leaves the lowercase common noun', () => {
    expect(substituteCharacterNames('Star reaches for the falling star.', starMap)).toBe(
      'Character 1 reaches for the falling star.',
    );
  });

  it('leaves "the summer meadow" alone for a child named Summer', () => {
    expect(
      substituteCharacterNames('the summer meadow', [{ name: 'Summer', token: 'Character 1' }]),
    ).toBe('the summer meadow');
  });

  it('leaves "a rose" alone for a child named Rose', () => {
    expect(substituteCharacterNames('a rose', [{ name: 'Rose', token: 'Character 1' }])).toBe(
      'a rose',
    );
  });

  it('substitutes exact, possessive, ALL-CAPS, and ALL-CAPS-possessive occurrences', () => {
    expect(substituteCharacterNames("Star's wand, STAR'S cape, STAR shouts", starMap)).toBe(
      "Character 1's wand, Character 1'S cape, Character 1 shouts",
    );
  });

  it('substitutes accented uppercase variants (ÉMILE for Émile)', () => {
    const map = [{ name: 'Émile', token: 'Character 1' }];
    expect(substituteCharacterNames('ÉMILE jumps while Émile laughs', map)).toBe(
      'Character 1 jumps while Character 1 laughs',
    );
  });

  it('keeps whole-word boundaries and longest-first ordering', () => {
    const map = [
      { name: 'Star', token: 'Character 1' },
      { name: 'Starla', token: 'Character 2' },
    ];
    expect(substituteCharacterNames('Starla hands Star a starfish', map)).toBe(
      'Character 2 hands Character 1 a starfish',
    );
  });
});

describe('createIllustrationPrompt — neutralizeCharacterNames (avatar interior)', () => {
  const neutral = createIllustrationPrompt({ ...baseOpts, neutralizeCharacterNames: true });

  it('contains no roster display name anywhere', () => {
    expect(neutral).not.toContain('Grypho');
    expect(neutral).not.toContain('Kaito');
    expect(neutral).not.toMatch(asWord('Kai'));
  });

  it('binds each sheet to a Character N token, species phrase intact', () => {
    expect(neutral).toContain('image 1 = Character 1, a young boy');
    expect(neutral).toContain('image 2 = Character 2, a young boy');
    expect(neutral).toContain('image 3 = Character 3, a black-and-orange toy crocodile');
  });

  it('tokenizes the exact-cast line', () => {
    expect(neutral).toContain(
      'Draw EXACTLY these characters, each exactly once and no more: Character 2, Character 1, Character 3.',
    );
  });

  it('tokenizes the scene action and props with word-boundary safety', () => {
    expect(neutral).toContain(
      'Compose this moment: Character 1 hugs Character 2 while Character 3 naps on the mossy log.',
    );
    expect(neutral).toContain("Character 1's paper map");
    expect(neutral).not.toContain('Character 1to'); // "Kaito" must never be chewed by "Kai"
  });

  it('tokenizes identity headers and style-rendering descriptions', () => {
    expect(neutral).toContain('- Character 1 (main_child):');
    expect(neutral).toContain('Center Character 1 in the vignette.');
    expect(neutral).toContain('Position Character 3 at the same scale as on the sheet.');
  });

  it('keeps the anti-name-semantics line (cheap insurance)', () => {
    expect(neutral).toContain("A character's NAME is just a label");
  });

  it('tokenizes the quoted pageText on the null-scene fallback', () => {
    const fallback = createIllustrationPrompt({
      ...baseOpts,
      neutralizeCharacterNames: true,
      bridgeScene: null,
    });
    expect(fallback).toContain('"Character 1 tiptoes past Character 3."');
    expect(fallback).not.toContain('Grypho');
  });

  it('tokenizes roster names inside illustration notes', () => {
    const withNotes = createIllustrationPrompt({
      ...baseOpts,
      neutralizeCharacterNames: true,
      illustrationNotes: 'Motion lines as Grypho tumbles',
    });
    expect(withNotes).toContain('Specific effect to add: Motion lines as Character 3 tumbles');
  });

  it('tokenizes roster names inside sheetRoster species phrases', () => {
    const withSpeciesLeak = createIllustrationPrompt({
      ...baseOpts,
      neutralizeCharacterNames: true,
      sheetRoster: [
        { name: 'Kai', species: 'a young boy' },
        { name: 'Kaito', species: "Kai's older brother, a young boy" },
        { name: 'Grypho', species: "Grypho, Kai's black-and-orange toy crocodile" },
      ],
    });
    expect(withSpeciesLeak).toContain(
      "image 2 = Character 2, Character 1's older brother, a young boy",
    );
    expect(withSpeciesLeak).toContain(
      "image 3 = Character 3, Character 3, Character 1's black-and-orange toy crocodile",
    );
    expect(withSpeciesLeak).not.toContain('Grypho');
    expect(withSpeciesLeak).not.toMatch(asWord('Kai'));
  });

  it('tokenizes roster names inside QC feedback (the QC-escalation requeue prompt)', () => {
    const feedback = "Grypho gained a second tail and Kai's raincoat turned blue.";
    const requeue = createIllustrationPrompt({
      ...baseOpts,
      neutralizeCharacterNames: true,
      qcFeedback: feedback,
    });
    expect(requeue).toContain('CRITICAL CORRECTIONS');
    expect(requeue).toContain(
      "Character 3 gained a second tail and Character 1's raincoat turned blue.",
    );
    expect(requeue).not.toContain('Grypho');

    // Verbatim when neutral mode is off.
    const off = createIllustrationPrompt({ ...baseOpts, qcFeedback: feedback });
    expect(off).toContain(feedback);
  });
});

describe('createIllustrationPrompt — neutralizeCharacterNames (avatar cover)', () => {
  it('renders the book title verbatim but tokenizes the cast sections', () => {
    const cover = createIllustrationPrompt({
      ...baseOpts,
      neutralizeCharacterNames: true,
      isTitlePage: true,
      contentAnchor: 'interior',
      characterSheetCount: 3,
      bridgeScene: null,
      sheetRoster: undefined,
    });
    // The exact-title line is untouchable — the child's real name may live there.
    expect(cover).toContain(
      'Render this exact title text and nothing more: "Kai and the Wild Rumble".',
    );
    // Cast/identity sections are tokenized.
    expect(cover).toContain('- Character 1 (main_child):');
    expect(cover).not.toContain('Grypho');
    expect(cover).not.toContain('Kaito');
  });
});

describe('createIllustrationPrompt — neutral mode default-off is byte-identical', () => {
  it('absent and explicit-false produce the exact same prompt', () => {
    const absent = createIllustrationPrompt({ ...baseOpts });
    const explicitFalse = createIllustrationPrompt({
      ...baseOpts,
      neutralizeCharacterNames: false,
    });
    expect(explicitFalse).toBe(absent);
    // and names render exactly as today
    expect(absent).toContain('image 3 = Grypho, a black-and-orange toy crocodile');
    expect(absent).toContain('Compose this moment: Kai hugs Kaito while Grypho naps');
  });

  it('holds across the cover, qcFeedback, and null-scene fallback shapes', () => {
    const shapes: IllustrationPromptOptions[] = [
      // Avatar cover (isTitlePage + interior anchor)
      {
        ...baseOpts,
        isTitlePage: true,
        contentAnchor: 'interior',
        characterSheetCount: 3,
        bridgeScene: null,
        sheetRoster: undefined,
      },
      // QC-escalation requeue (qcFeedback present)
      { ...baseOpts, qcFeedback: "Grypho gained a second tail; fix Kai's raincoat." },
      // Null-scene fallback (quoted pageText path)
      { ...baseOpts, bridgeScene: null },
    ];
    for (const shape of shapes) {
      expect(createIllustrationPrompt({ ...shape, neutralizeCharacterNames: false })).toBe(
        createIllustrationPrompt(shape),
      );
    }
  });

  it('never touches the photo path even when the option is (incorrectly) set', () => {
    const photoOpts: IllustrationPromptOptions = {
      style: 'vignette',
      pageText: 'Kai tiptoes past Grypho.',
      bookTitle: 'Kai and the Wild Rumble',
      isTitlePage: false,
      referenceImageCount: 2,
      characterIdentity: identity,
      pageNumber: 4,
      language: 'en',
    };
    const off = createIllustrationPrompt(photoOpts);
    const on = createIllustrationPrompt({ ...photoOpts, neutralizeCharacterNames: true });
    expect(on).toBe(off);
  });
});

describe('createIllustrationPrompt — 0 style refs on the sheet-anchor branch (X12-D diet)', () => {
  it('drops the style-role line and counts only the sheets', () => {
    const prompt = createIllustrationPrompt({ ...baseOpts, referenceImageCount: 0 });
    // 1 anchor sheet + 2 extra sheets, no style images.
    expect(prompt).toContain('using the 3 images provided, in this order:');
    expect(prompt).toContain('images 1-3 are CHARACTER SHEETS');
    expect(prompt).not.toContain('the artistic style to apply');
  });

  it('a positive count keeps the existing wording byte-identical', () => {
    const prompt = createIllustrationPrompt({ ...baseOpts, referenceImageCount: 2 });
    expect(prompt).toContain('using the 5 images provided, in this order:');
    expect(prompt).toContain('the final 2 images show the artistic style to apply');
  });
});
