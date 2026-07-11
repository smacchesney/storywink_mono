import { describe, it, expect } from 'vitest';
import {
  countRefrainEchoes,
  isChildNameCheckable,
  countChildNameEchoes,
  createStoryQCPrompt,
  countLearningWordEchoes,
} from './story-check.js';
import type { StoryArc } from './story.js';

describe('countRefrainEchoes (en)', () => {
  const refrain = 'Splish, splash, one more splash!';

  it('counts pages that echo the refrain with variation', () => {
    const pages = [
      'Splish, splash, one more splash!', // exact
      'Splish and a splash!', // splish + splash → 3 significant hits
      'One more big splash today.', // splash + one + more → hits
      'The dog ran home.', // no echo
      'He saw one bird.', // only "one" → below the half-of-words threshold
    ];
    expect(countRefrainEchoes(refrain, pages, 'en')).toBe(3);
  });

  it('does not count pages with no significant overlap', () => {
    const pages = ['The sky was blue.', 'Bath time is over.'];
    expect(countRefrainEchoes(refrain, pages, 'en')).toBe(0);
  });

  it('matches punctuation-insensitively', () => {
    // Refrain is drenched in punctuation; the echoing page has none.
    const punctRefrain = '"Splish!" — splash, splash…';
    const pages = ['splish splash and another splash'];
    expect(countRefrainEchoes(punctRefrain, pages, 'en')).toBe(1);
  });

  it('returns 0 for an empty refrain', () => {
    expect(countRefrainEchoes('', ['anything at all here'], 'en')).toBe(0);
    expect(countRefrainEchoes('   ', ['anything at all here'], 'en')).toBe(0);
  });

  it('defaults to en when no language is passed', () => {
    expect(countRefrainEchoes(refrain, ['Splish, splash, splash!'])).toBe(1);
  });
});

describe('countRefrainEchoes (ja)', () => {
  const refrain = 'ざぶーん、もういっかい';

  it('matches varied ja refrains via contiguous character runs', () => {
    const pages = [
      'ざぶーん！もういっかい！', // refrain with different punctuation
      'みずが もういっかい ざぶん', // reordered / varied, still shares runs
      'こんにちは せかい', // unrelated → no run overlap
    ];
    expect(countRefrainEchoes(refrain, pages, 'ja')).toBe(2);
  });

  it('is punctuation-insensitive for ja', () => {
    const pages = ['もういっかい。'];
    expect(countRefrainEchoes(refrain, pages, 'ja')).toBe(1);
  });

  it('returns 0 when no page shares a 4-char run with the refrain', () => {
    const pages = ['ねこが ねむる', 'とりが とぶ'];
    expect(countRefrainEchoes(refrain, pages, 'ja')).toBe(0);
  });
});

describe('isChildNameCheckable (script gate)', () => {
  it('accepts Latin names in en books', () => {
    expect(isChildNameCheckable('Emma', 'en')).toBe(true);
    expect(isChildNameCheckable('Anne-Marie', 'en')).toBe(true);
    expect(isChildNameCheckable('Léa')).toBe(true); // defaults to en
  });

  it('accepts kana names in ja books', () => {
    expect(isChildNameCheckable('えま', 'ja')).toBe(true);
    expect(isChildNameCheckable('ケンタ', 'ja')).toBe(true);
    expect(isChildNameCheckable('リーサ', 'ja')).toBe(true); // long vowel mark
  });

  it('rejects kanji names in any language (reading is unknown)', () => {
    expect(isChildNameCheckable('健太', 'ja')).toBe(false);
    expect(isChildNameCheckable('健太', 'en')).toBe(false);
    expect(isChildNameCheckable('さくら花', 'ja')).toBe(false); // mixed kana+kanji
  });

  it('rejects cross-script names', () => {
    // Latin name in a ja book gets transliterated to katakana by the prompt.
    expect(isChildNameCheckable('Emma', 'ja')).toBe(false);
    // Kana name in an en book — no reliable rendering to check against.
    expect(isChildNameCheckable('えま', 'en')).toBe(false);
    // Mixed-script names are never checkable.
    expect(isChildNameCheckable('Emmaちゃん', 'en')).toBe(false);
    expect(isChildNameCheckable('Emmaちゃん', 'ja')).toBe(false);
  });

  it('rejects empty and whitespace names', () => {
    expect(isChildNameCheckable('', 'en')).toBe(false);
    expect(isChildNameCheckable('  ', 'ja')).toBe(false);
  });
});

describe('countChildNameEchoes', () => {
  it('counts pages mentioning a Latin name, case- and punctuation-insensitively', () => {
    const pages = [
      'Emma wiggles her toes.',
      'The waves whisper to EMMA!',
      'The dog runs home.',
      '"Goodnight, Emma," says Mama.',
    ];
    const result = countChildNameEchoes('Emma', pages);
    expect(result.pagesWithName).toBe(3);
    expect(result.nameInLanding).toBe(true);
  });

  it('does not match a Latin name inside a longer word', () => {
    const result = countChildNameEchoes('Sam', ['Samantha runs.', 'Sam jumps!']);
    expect(result.pagesWithName).toBe(1);
  });

  it('reports nameInLanding false when the name misses the final pages', () => {
    const pages = [
      'Emma at the park.',
      'Emma on the swing.',
      'Up and up she goes.',
      'Down for a nap.',
      'Sleep tight, little one.',
    ];
    const result = countChildNameEchoes('Emma', pages);
    expect(result.pagesWithName).toBe(2);
    expect(result.nameInLanding).toBe(false);
  });

  it('matches kana names as substrings (particles attach directly)', () => {
    const pages = ['えまが わらう', 'ざぶーん！', 'おやすみ、えま。'];
    const result = countChildNameEchoes('えま', pages);
    expect(result.pagesWithName).toBe(2);
    expect(result.nameInLanding).toBe(true);
  });

  it('handles empty inputs', () => {
    expect(countChildNameEchoes('', ['text'])).toEqual({ pagesWithName: 0, nameInLanding: false });
    expect(countChildNameEchoes('Emma', [])).toEqual({ pagesWithName: 0, nameInLanding: false });
  });
});

describe('createStoryQCPrompt context block', () => {
  const storyArc: StoryArc = {
    desire: 'To splash in every puddle',
    refrain: 'Splish, splash!',
    emotionalPeak: 'The biggest puddle of all',
    resolution: 'Warm and dry at home',
  };
  const pages = [{ pageNumber: 1, text: 'Splish!' }];

  it('renders eventSummary with confirmedFacts, superseding theme', () => {
    const prompt = createStoryQCPrompt({
      storyArc,
      pages,
      theme: 'A rainy day',
      eventSummary: "Emma's first rainy walk to the park",
      confirmedFacts: ['Who joined? → Grandma'],
    });
    expect(prompt).toContain("Emma's first rainy walk to the park");
    expect(prompt).toContain('- Parent confirmed: Who joined? → Grandma');
    expect(prompt).not.toContain('A rainy day');
    expect(prompt).toContain('truthToEvent (0-10, or null)');
    expect(prompt).not.toContain('return null');
  });

  it('falls back to theme without eventSummary and nulls truthToEvent', () => {
    const prompt = createStoryQCPrompt({
      storyArc,
      pages,
      theme: 'A rainy day',
      confirmedFacts: ['Who joined? → Grandma'],
    });
    expect(prompt).toContain('A rainy day');
    // Facts render only under the eventSummary-present condition, mirroring generation.
    expect(prompt).not.toContain('Parent confirmed');
    expect(prompt).toContain('No event summary was provided — return null.');
  });
});

describe('countLearningWordEchoes', () => {
  it('counts pages containing the word on boundaries (en)', () => {
    const pages = ['Splash! goes Mia.', 'The catalog page.', 'One more splash.'];
    expect(countLearningWordEchoes('splash', pages, 'en')).toBe(2);
    expect(countLearningWordEchoes('cat', pages, 'en')).toBe(0);
  });

  it('counts CJK words as substrings (ja)', () => {
    const pages = ['かさを さして', 'あめが ざあざあ', 'かさは まほう'];
    expect(countLearningWordEchoes('かさ', pages, 'ja')).toBe(2);
  });
});
