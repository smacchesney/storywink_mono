import { describe, it, expect } from 'vitest';
import { createStoryGenerationPrompt, StoryGenerationInput } from './story.js';

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
