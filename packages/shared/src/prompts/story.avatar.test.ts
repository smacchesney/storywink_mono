import { describe, it, expect } from 'vitest';
import {
  createAvatarStoryPrompt,
  AvatarStoryGenerationInput,
  STORY_RESPONSE_SCHEMA_AVATAR,
  STORY_RESPONSE_SCHEMA,
  AVATAR_STORY_SYSTEM_PROMPT,
} from './story.js';

function promptText(input: AvatarStoryGenerationInput): string {
  return createAvatarStoryPrompt(input)
    .map((part) => ('text' in part ? part.text : '[IMAGE]'))
    .join('\n');
}

const baseInput: AvatarStoryGenerationInput = {
  bookTitle: '',
  pageCount: 8,
  premise: 'A rainy-day rescue',
  childName: 'Emma',
  language: 'en',
  suggestTitle: true,
  cast: [
    { characterId: 'avatar_1', name: 'Emma', role: 'main_child' },
    { characterId: 'avatar_2', name: 'Grandma', role: 'grown-up' },
    { characterId: 'avatar_3', name: 'Biscuit', role: 'pet' },
  ],
};

describe('createAvatarStoryPrompt — structure', () => {
  it('emits text parts only — no image placeholders, no storyboard', () => {
    const parts = createAvatarStoryPrompt(baseInput);
    expect(parts.every((p) => 'text' in p)).toBe(true);
    const text = promptText(baseInput);
    expect(text).not.toContain('Storyboard');
    expect(text).not.toContain('No Image Provided');
  });

  it('demands exactly pageCount pages and marks page 1 as the cover moment', () => {
    const text = promptText(baseInput);
    expect(text).toContain('Return EXACTLY 8 pages, numbered 1 to 8');
    expect(text).toContain("Page 1 is also the book's cover moment");
  });

  it('renders the premise as the spark the story must deliver', () => {
    const text = promptText(baseInput);
    expect(text).toContain('"A rainy-day rescue"');
    expect(text).toContain('The story must DELIVER this spark');
  });

  it('requires a structured scene per page with roster-only characters', () => {
    const text = promptText(baseInput);
    expect(text).toContain('For EACH page fill "scene"');
    expect(text).toContain('"charactersPresent" lists the characterIds');
  });

  it("ties scene.action + charactersPresent to the page text's focal cast (B1)", () => {
    const text = promptText(baseInput);
    expect(text).toContain('"scene.action" must name WHO does WHAT');
    expect(text).toContain(
      'every character the page text names as present or acting on this page MUST appear in "charactersPresent"',
    );
  });

  it('asks for prop-holder phrasing matching the QC "held by" convention (B3)', () => {
    const text = promptText(baseInput);
    expect(text).toContain('phrase that prop with its holder inside the props string');
    expect(text).toContain('"lantern held by Kai"');
  });

  it('instructs the model to author scene.mood + scene.focus (L1 meaning fields)', () => {
    const text = promptText(baseInput);
    // mood is seeded from the emotionalPeak trajectory; focus is the single
    // character+action the composition centers on.
    expect(text).toContain('"scene.mood"');
    expect(text).toContain('emotionalPeak');
    expect(text).toContain('"scene.focus"');
  });
});

describe('createAvatarStoryPrompt — cast rendering', () => {
  it('lists every cast member with characterId, role flavor, and star billing', () => {
    const text = promptText(baseInput);
    expect(text).toContain('characterId "avatar_1" = Emma (main child) — the STAR');
    expect(text).toContain('characterId "avatar_2" = Grandma (grown-up)');
    expect(text).toContain('characterId "avatar_3" = Biscuit (pet)');
    expect(text).toContain('never a talking character');
  });

  it('keeps the never-invent-names discipline', () => {
    const text = promptText(baseInput);
    expect(text).toContain('NEVER invent a new person, pet, or named place');
  });

  it('gives companion objects the grounded-object treatment', () => {
    const text = promptText({
      ...baseInput,
      cast: [
        ...baseInput.cast,
        { characterId: 'avatar_4', name: 'Mr. Hoppy', role: 'companion_object' },
      ],
    });
    expect(text).toContain('characterId "avatar_4" = Mr. Hoppy (companion object)');
    expect(text).toContain('it never walks, talks, or acts on its own');
  });

  describe('toys come alive (X13 Track T)', () => {
    const toyCast: AvatarStoryGenerationInput = {
      ...baseInput,
      cast: [
        ...baseInput.cast,
        { characterId: 'avatar_4', name: 'Mr. Hoppy', role: 'companion_object' },
      ],
    };

    it('flag OFF keeps the grounded-object rule verbatim (byte-identical)', () => {
      const off = promptText(toyCast);
      const absent = promptText({ ...toyCast, toysComeAlive: undefined });
      expect(off).toContain('it never walks, talks, or acts on its own');
      expect(off).toBe(absent);
    });

    it('flag ON turns the toy into a living companion and drops the never-acts rule', () => {
      const on = promptText({ ...toyCast, toysComeAlive: true });
      expect(on).not.toContain('it never walks, talks, or acts on its own');
      expect(on).toContain('brought to life');
      expect(on).toMatch(/adventur/i);
      // The cast line + billing are untouched.
      expect(on).toContain('characterId "avatar_4" = Mr. Hoppy (companion object)');
    });

    it('flag ON leaves the REAL-pet realism flavor untouched', () => {
      const on = promptText({ ...toyCast, toysComeAlive: true });
      expect(on).toContain('never a talking character');
    });
  });

  it('includes appearance descriptions when provided', () => {
    const text = promptText({
      ...baseInput,
      cast: [
        {
          characterId: 'avatar_1',
          name: 'Emma',
          role: 'main_child',
          description: 'curly brown hair, yellow raincoat',
        },
      ],
    });
    expect(text).toContain('Appearance: curly brown hair, yellow raincoat.');
  });
});

describe('createAvatarStoryPrompt — shared machinery retained', () => {
  it('keeps the 20/60/20 arc, refrain, hand-off, and dialogic machinery', () => {
    const text = promptText(baseInput);
    expect(text).toContain('OPENING** (first ~20% of pages)');
    expect(text).toContain('BUILDING** (middle ~60%)');
    expect(text).toContain('LANDING** (final ~20%)');
    expect(text).toContain('Recurring Refrain (REQUIRED)');
    expect(text).toContain('Hand-off rule');
    expect(text).toContain('Dialogic Moments');
  });

  it('weaves learning words when provided, capped at four', () => {
    const text = promptText({
      ...baseInput,
      learningWords: ['puddle', 'umbrella', 'splash', 'cloud', 'extra'],
    });
    expect(text).toContain('"puddle", "umbrella", "splash", "cloud"');
    expect(text).not.toContain('"extra"');
    expect(text).toContain('learningWordsUsed');
  });

  it('renders qcFeedback corrections on regeneration', () => {
    const text = promptText({ ...baseInput, qcFeedback: '1. Fix the landing.' });
    expect(text).toContain('CRITICAL CORRECTIONS');
    expect(text).toContain('1. Fix the landing.');
  });

  it('renders ja instructions with English-only scene fields', () => {
    const text = promptText({ ...baseInput, language: 'ja' });
    expect(text).toContain('Language — Japanese');
    expect(text).toContain('"illustrationNotes" and "scene" fields must remain in **English**');
  });

  it('never treats photos as source material (only the NO-photos disclosure)', () => {
    const text = promptText(baseInput);
    expect(text).not.toContain('in the photos');
    expect(text).not.toContain("this page's photo");
    expect(text).not.toContain('ARC ROLE');
    expect(text).toContain('the illustrator has NO photos');
  });

  it('keeps illustrationNotes wordless: forbids sound-effect text, no quoted sound-words', () => {
    const text = promptText(baseInput);
    expect(text).toContain(
      'NEVER suggest words, letters, numbers, or sound-effect text in "illustrationNotes"',
    );
    // The FULL set the effect-example lines used to quote.
    for (const token of [
      '"ZOOM!"',
      '"WHOOSH!"',
      '"SPLASH!"',
      '"SPLISH!"',
      '"YUM!"',
      '"MUNCH!"',
      '"CHOMP!"',
      '"BOING!"',
      '"WHEEE!"',
      '"WOW!"',
      '"OOOOH!"',
    ]) {
      expect(text).not.toContain(token);
    }
    expect(text).toContain('motion lines, speed streaks');
  });
});

describe('STORY_RESPONSE_SCHEMA_AVATAR', () => {
  it('requires a scene on every page (L1: mood + focus join the contract)', () => {
    const pageItems = STORY_RESPONSE_SCHEMA_AVATAR.properties.pages.items;
    expect(pageItems.required).toContain('scene');
    // Deliberate re-baseline (X13 Track L): mood + focus are appended as
    // required-nullable meaning fields — every property is in `required`
    // (strict mode) with a nullable type carrying the degrade case.
    expect(pageItems.properties.scene.required).toEqual([
      'location',
      'timeOfDay',
      'action',
      'charactersPresent',
      'props',
      'mood',
      'focus',
    ]);
  });

  it('carries mood + focus as required-nullable meaning fields (strict mode)', () => {
    const sceneProps =
      STORY_RESPONSE_SCHEMA_AVATAR.properties.pages.items.properties.scene.properties;
    expect(sceneProps.mood.type).toEqual(['string', 'null']);
    expect(sceneProps.focus.type).toEqual(['string', 'null']);
  });

  it('has no outfitFrom (no adjacent photo exists) and no bridgePages', () => {
    const sceneProps =
      STORY_RESPONSE_SCHEMA_AVATAR.properties.pages.items.properties.scene.properties;
    expect('outfitFrom' in sceneProps).toBe(false);
    expect('bridgePages' in STORY_RESPONSE_SCHEMA_AVATAR.properties).toBe(false);
  });

  it('keeps the photo response contract fields on pages', () => {
    const pageItems = STORY_RESPONSE_SCHEMA_AVATAR.properties.pages.items;
    for (const field of STORY_RESPONSE_SCHEMA.properties.pages.items.required) {
      expect(pageItems.required).toContain(field);
    }
  });
});

describe('AVATAR_STORY_SYSTEM_PROMPT', () => {
  it('frames the book as an invented adventure with a real cast', () => {
    expect(AVATAR_STORY_SYSTEM_PROMPT).toContain('there are no photos');
    expect(AVATAR_STORY_SYSTEM_PROMPT).toContain('re-read this 100 times');
  });

  it('widens to ages 3-5 with the adventure north-star (S4)', () => {
    expect(AVATAR_STORY_SYSTEM_PROMPT).toContain('ages 3-5');
    expect(AVATAR_STORY_SYSTEM_PROMPT).toContain('a beginning, a problem, and a satisfying end');
    expect(AVATAR_STORY_SYSTEM_PROMPT).not.toContain('toddlers (ages 2-4)');
  });

  it('drops the toddler-at-bedtime read-aloud frame from the instructions', () => {
    const text = promptText(baseInput);
    expect(text).toContain('curled up with their child, reading aloud');
    expect(text).not.toContain('their toddler at bedtime');
  });
});

describe('createAvatarStoryPrompt — S1 sound exemplars neutralized + cap', () => {
  const text = promptText(baseInput);
  const jaText = promptText({ ...baseInput, language: 'ja' });

  it('drops every sound-pushing exemplar (shares the photo blocks verbatim)', () => {
    expect(text).not.toContain('Splish, splash, one more splash!');
    expect(text).not.toContain('("Splish!")');
    expect(text).not.toContain('rumble, swoosh, crunch, pitter-pat');
    expect(text).not.toContain('How many splashes was that?');
    expect(text).not.toContain('funny sounds');
    expect(jaText).not.toContain('Katakana is OK for onomatopoeia and foreign words');
    expect(jaText).not.toContain('どきどき');
    expect(jaText).not.toContain('ぴょんぴょん');
    expect(jaText).not.toContain('きらきら');
  });

  it('carries the same one-sound-word-per-page cap', () => {
    expect(text).toContain('AT MOST one sound word per page');
    expect(text).toContain("never as the page's main event");
    expect(text).toContain('one spice among many');
    expect(jaText).toContain('at most one per page');
  });

  it('mirrors the neutralized refrain / fragment / hand-off / question examples', () => {
    expect(text).toContain('One more step, brave Kai!');
    expect(text).toContain('"Up, up, up!"');
    expect(text).toContain('a shadow slipping across the floor');
    expect(text).toContain('What do YOU think is behind the door?');
  });
});

describe('createAvatarStoryPrompt — S3 agency arc', () => {
  const text = promptText(baseInput);

  it('names the child as the DOER and reframes humor as situation-driven', () => {
    expect(text).toContain('The child is the DOER');
    expect(text).toContain('comes from the SITUATION, not sound effects');
  });

  it('lands on the win with an inferred tone (never asks the parent)', () => {
    expect(text).toContain('Land on the WIN');
    expect(text).toContain('never ask the parent');
  });

  it('adds obstacle + tryAndOvercome to the storyArc planning instruction', () => {
    expect(text).toContain('obstacle');
    expect(text).toContain('tryAndOvercome');
  });
});

describe('STORY_RESPONSE_SCHEMA_AVATAR — shared storyArc carries the agency fields', () => {
  it('inherits obstacle + tryAndOvercome from the shared storyArc reference', () => {
    const arc = STORY_RESPONSE_SCHEMA_AVATAR.properties.storyArc;
    expect(arc.required).toContain('obstacle');
    expect(arc.required).toContain('tryAndOvercome');
    expect(arc).toBe(STORY_RESPONSE_SCHEMA.properties.storyArc);
  });
});
