import { describe, it, expect } from 'vitest';
import {
  createStoryGenerationPrompt,
  StoryGenerationInput,
  STORY_RESPONSE_SCHEMA,
  STORY_GENERATION_SYSTEM_PROMPT,
} from './story.js';

function promptText(input: StoryGenerationInput): string {
  return createStoryGenerationPrompt(input)
    .map((part) => ('text' in part ? part.text : ''))
    .join('\n');
}

const baseInput: StoryGenerationInput = {
  bookTitle: 'Splash Day',
  isDoubleSpread: false,
  childName: 'Emma',
  language: 'en',
  storyPages: [
    { pageId: 'p1', pageNumber: 1, assetId: 'a1', originalImageUrl: null, analysis: null },
    { pageId: 'p2', pageNumber: 2, assetId: 'a2', originalImageUrl: null, analysis: null },
  ],
};

describe('createStoryGenerationPrompt — cast rendering', () => {
  it('always includes the never-invent-names policy (en)', () => {
    const text = promptText(baseInput);
    expect(text).toContain('NEVER invent a proper name for anyone');
    expect(text).toContain('For unnamed pets');
  });

  it('includes the ja relationship-word policy for ja books', () => {
    const text = promptText({ ...baseInput, language: 'ja' });
    expect(text).toContain('おばあちゃん');
    expect(text).toContain('わんちゃん');
  });

  it('renders exact pages for fully-resolved supporting characters', () => {
    const text = promptText({
      ...baseInput,
      charactersInPhotos: [{ name: 'Grandma', role: 'grandparent', appearsOnPages: [1, 2] }],
    });
    expect(text).toContain('Grandma (grandparent) appears on page(s) 1, 2');
    expect(text).not.toContain('exact pages unknown');
  });

  it('renders the page-less variant when appearsOnPages is empty', () => {
    const text = promptText({
      ...baseInput,
      charactersInPhotos: [{ name: 'Grandma', role: 'grandparent', appearsOnPages: [] }],
    });
    expect(text).toContain(
      'Grandma (grandparent) appears in several of the photos (exact pages unknown)',
    );
    expect(text).toContain('include them only on pages where you can actually see them');
    expect(text).not.toContain('appears on page(s)');
  });

  it('mixes exact and page-less variants per character', () => {
    const text = promptText({
      ...baseInput,
      charactersInPhotos: [
        { name: 'Grandma', role: 'grandparent', appearsOnPages: [2] },
        { name: 'sibling', role: 'sibling', appearsOnPages: [] },
      ],
    });
    expect(text).toContain('Grandma (grandparent) appears on page(s) 2');
    expect(text).toContain('sibling (sibling) appears in several of the photos');
    expect(text).toContain('include them only on pages where you can actually see them');
  });

  it('excludes the main child from the supporting cast block', () => {
    const text = promptText({
      ...baseInput,
      charactersInPhotos: [{ name: 'Emma', role: 'main_child', appearsOnPages: [1, 2] }],
    });
    expect(text).not.toContain('SUPPORTING CAST');
  });
});

describe('createStoryGenerationPrompt — bridge pages (BRIDGE_PAGES_ENABLED)', () => {
  const rosterInput: StoryGenerationInput = {
    ...baseInput,
    charactersInPhotos: [
      { characterId: 'char-1', name: 'Emma', role: 'main_child', appearsOnPages: [1, 2] },
      { characterId: 'char-2', name: 'Grandma', role: 'grandparent', appearsOnPages: [2] },
    ],
  };

  it('renders NO bridge section without a cap (flag-off stays byte-identical)', () => {
    expect(promptText(rosterInput)).not.toContain('BRIDGE PAGES');
    expect(promptText({ ...rosterInput, bridgeCap: 0 })).not.toContain('BRIDGE PAGES');
  });

  it('renders NO bridge section when the roster carries no characterIds', () => {
    const text = promptText({
      ...baseInput,
      bridgeCap: 2,
      charactersInPhotos: [{ name: 'Grandma', role: 'grandparent', appearsOnPages: [2] }],
    });
    expect(text).not.toContain('BRIDGE PAGES');
  });

  it('renders the capped, roster-grounded section when enabled', () => {
    const text = promptText({ ...rosterInput, bridgeCap: 2 });
    expect(text).toContain('BRIDGE PAGES (optional — most books need ZERO)');
    expect(text).toContain('up to 2 bridge page(s)');
    expect(text).toContain('characterId "char-1" = Emma (main child)');
    expect(text).toContain('characterId "char-2" = Grandma (grandparent)');
    expect(text).toContain('At most ONE bridge per gap, and never before the first photo');
    expect(text).toContain('"bridgePages" array');
  });

  it('states the trailing-bridge convention with the real page count', () => {
    const text = promptText({ ...rosterInput, bridgeCap: 1 });
    expect(text).toContain('(2 = after the last photo)');
  });
});

describe('createStoryGenerationPrompt — parent-picked mood', () => {
  it('claims parental provenance and renders the mood block when tone is set', () => {
    const text = promptText({ ...baseInput, tone: 'silly' });
    expect(text).toContain('## Story Mood (picked by the parent):');
    expect(text).toContain('The parent asked for a **"silly"** telling.');
    expect(text).toContain('a promise to the parent, not a garnish');
  });

  it('omits the mood block entirely when tone is absent', () => {
    const text = promptText(baseInput);
    expect(text).not.toContain('Story Mood');
    expect(text).not.toContain('picked by the parent');
  });

  it('keeps the mood block independent of the experience-context block', () => {
    const text = promptText({
      ...baseInput,
      tone: 'dreamy',
      eventSummary: 'A rainy-day trip to the aquarium.',
    });
    expect(text).toContain('## Story Mood (picked by the parent):');
    expect(text).toContain('What actually happened');
  });
});

describe('createStoryGenerationPrompt — companion objects', () => {
  it('a named companion object gets grounded-object instructions with the confirmed name', () => {
    const text = promptText({
      ...baseInput,
      charactersInPhotos: [
        { characterId: 'child_1', name: 'Emma', role: 'main_child', appearsOnPages: [1, 2] },
        {
          characterId: 'object_1',
          name: 'Mr. Hoppy',
          role: 'companion_object',
          appearsOnPages: [1, 2],
          namedVia: 'chip',
        },
      ],
    });
    expect(text).toContain('call it "Mr. Hoppy" in the story text');
    expect(text).toContain('never walks, talks, or acts on its own');
    expect(text).toContain('treasured companion');
  });

  it('unnamed objects get simple object words, never invented names', () => {
    const text = promptText(baseInput);
    expect(text).toContain('simple object words');
    expect(text).toContain('Never name a pet or object');
  });
});

describe('createStoryGenerationPrompt — illustrationNotes stay wordless', () => {
  const text = promptText(baseInput);

  it('forbids words, letters, or sound-effect text in illustrationNotes', () => {
    expect(text).toContain(
      'NEVER suggest words, letters, numbers, or sound-effect text in "illustrationNotes"',
    );
  });

  it('no longer offers quoted sound-words as effect examples', () => {
    // The FULL set the effect-example lines used to quote — any one creeping
    // back re-teaches the model to paint lettering.
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

describe('createStoryGenerationPrompt — learning words', () => {
  it('renders the weaving rules with the parent words and the child name', () => {
    const text = promptText({ ...baseInput, learningWords: ['splash', 'umbrella'] });
    expect(text).toContain('LEARNING WORDS');
    expect(text).toContain('"splash", "umbrella"');
    expect(text).toContain('3-4 times');
    expect(text).toContain('END of a sentence');
    expect(text).toContain('"Emma"');
    expect(text).toContain('learningWordsUsed');
  });

  it('emits nothing without learning words', () => {
    expect(promptText(baseInput)).not.toContain('LEARNING WORDS');
  });

  it('caps at four words', () => {
    const text = promptText({ ...baseInput, learningWords: ['a', 'b', 'c', 'd', 'e'] });
    expect(text).toContain('"a", "b", "c", "d"');
    expect(text).not.toContain('"e"');
  });
});

describe('createStoryGenerationPrompt — S1 sound exemplars neutralized + cap', () => {
  const text = promptText(baseInput);
  const jaText = promptText({ ...baseInput, language: 'ja' });

  it('drops every sound-pushing exemplar the model used to copy', () => {
    expect(text).not.toContain('Splish, splash, one more splash!');
    expect(text).not.toContain('("Splish!")');
    expect(text).not.toContain('rumble, swoosh, crunch, pitter-pat');
    expect(text).not.toContain('How many splashes was that?');
    expect(text).not.toContain('funny sounds');
    // ja block
    expect(jaText).not.toContain('Katakana is OK for onomatopoeia and foreign words');
    expect(jaText).not.toContain('どきどき');
    expect(jaText).not.toContain('ぴょんぴょん');
    expect(jaText).not.toContain('きらきら');
  });

  it('caps sound words at one per page, never the main event', () => {
    expect(text).toContain('AT MOST one sound word per page');
    expect(text).toContain("never as the page's main event");
    expect(text).toContain('one spice among many');
  });

  it('leads the refrain example with an action refrain, not a sound', () => {
    expect(text).toContain('One more step, brave Kai!');
  });

  it('uses an action fragment as the punchy-fragment example', () => {
    expect(text).toContain('"Up, up, up!"');
  });

  it('leads the hand-off examples with a non-sound cue', () => {
    expect(text).toContain('a shadow slipping across the floor');
  });

  it('uses a non-sound participation question example', () => {
    expect(text).toContain('What do YOU think is behind the door?');
  });

  it('reframes the ja sound-word rule under the one-per-page cap', () => {
    expect(jaText).toContain('at most one per page');
  });
});

describe('createStoryGenerationPrompt — S3 agency arc + S4 payoff/age frame', () => {
  const text = promptText(baseInput);

  it('names the child as the DOER in the narrative architecture', () => {
    expect(text).toContain('The child is the DOER');
    expect(text).toContain('try again before it works');
  });

  it('reframes humor as situation-driven, not sound effects', () => {
    expect(text).toContain('comes from the SITUATION, not sound effects');
    expect(text).toContain('repeats and grows');
  });

  it('lands on the win with an inferred tone (never asks the parent)', () => {
    expect(text).toContain('Land on the WIN');
    expect(text).toContain('Only sweet or sleepy stories');
    expect(text).toContain('never ask the parent');
  });

  it('adds obstacle + tryAndOvercome to the storyArc planning instruction', () => {
    expect(text).toContain('obstacle');
    expect(text).toContain('tryAndOvercome');
  });

  it('widens the system prompt to ages 3-5 with the adventure north-star', () => {
    expect(STORY_GENERATION_SYSTEM_PROMPT).toContain('ages 3-5');
    expect(STORY_GENERATION_SYSTEM_PROMPT).toContain(
      'a beginning, a problem, and a satisfying end',
    );
    expect(STORY_GENERATION_SYSTEM_PROMPT).not.toContain('toddlers (ages 2-4)');
  });

  it('drops the toddler-at-bedtime read-aloud frame from the instructions', () => {
    expect(text).toContain('curled up with their child, reading aloud');
    expect(text).not.toContain('their toddler at bedtime');
  });
});

describe('STORY_RESPONSE_SCHEMA — storyArc agency + payoff fields (S3/S4)', () => {
  const arc = STORY_RESPONSE_SCHEMA.properties.storyArc;

  it('requires obstacle and tryAndOvercome on the shared storyArc', () => {
    expect(arc.required).toContain('obstacle');
    expect(arc.required).toContain('tryAndOvercome');
  });

  it('models obstacle as required-string, tryAndOvercome as required-nullable', () => {
    expect(arc.properties.obstacle.type).toBe('string');
    expect(arc.properties.tryAndOvercome.type).toEqual(['string', 'null']);
  });

  it('retargets the resolution field to a tone-neutral payoff', () => {
    expect(arc.properties.resolution.description).toContain('payoff');
    expect(arc.properties.resolution.description).not.toContain('carry into sleep');
  });
});
