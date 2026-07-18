import { describe, it, expect } from 'vitest';
import {
  countRefrainEchoes,
  isChildNameCheckable,
  countChildNameEchoes,
  createStoryQCPrompt,
  countLearningWordEchoes,
  countWords,
  countJaChars,
  countSentences,
  wordBudgetProblems,
  findNameGarbles,
  rollCallProblems,
  STORY_QC_RESPONSE_SCHEMA,
  STORY_QC_SYSTEM_PROMPT,
  STORY_QC_THRESHOLDS,
  createAvatarStoryQCPrompt,
  AVATAR_STORY_QC_RESPONSE_SCHEMA,
} from './story-check.js';
import type { StoryArc, BeatSheetEntry } from './story.js';

const arc: StoryArc = {
  desire: 'To rescue the soggy teddy',
  obstacle: 'The teddy is stuck under the shed in the rain',
  throughline: 'Get teddy back before the rain stops — the umbrella keeps almost helping',
  tryAndOvercome: 'Emma tries a stick, then a broom, then asks Grandma for a boost',
  refrain: 'Splish, splash!',
  emotionalPeak: 'The biggest puddle of all',
  resolution: 'Warm and dry at home',
};

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
    obstacle: 'The biggest puddle is guarded by a grumpy goose',
    throughline: 'Win the big puddle from the goose — crumb by crumb',
    tryAndOvercome: 'She tiptoes, she waits, then she offers the goose a crumb',
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

describe('createStoryQCPrompt — S2/S3 retargeted rubric (photo)', () => {
  const prompt = createStoryQCPrompt({
    storyArc: arc,
    pages: [{ pageNumber: 1, text: 'Splish!' }],
  });

  it('stops praising sound words in the rhythm rubric', () => {
    expect(prompt).not.toContain('organic sound words score high');
    expect(prompt).toContain('leaning on sound words does NOT');
  });

  it('scores soundOverload and enforces it on the photo judge', () => {
    expect(prompt).toContain('soundOverload (boolean)');
    const failLine = prompt.split('\n').find((l) => l.startsWith('If ANY of these fail'));
    expect(failLine).toContain('soundOverload true');
  });

  it('scores agency and enforces it in the fail conditions (V2)', () => {
    expect(prompt).toContain('agency (0-10)');
    const failLine = prompt.split('\n').find((l) => l.startsWith('If ANY of these fail'));
    expect(failLine).toContain('agency < 6');
  });

  it('renders the obstacle + try in the declared-arc block', () => {
    expect(prompt).toContain('Obstacle:');
    expect(prompt).toContain('Try:');
  });
});

describe('STORY_QC_RESPONSE_SCHEMA — new fields (S2/S3)', () => {
  it('adds soundOverload (required-nullable) and agency (required number)', () => {
    expect(STORY_QC_RESPONSE_SCHEMA.required).toContain('soundOverload');
    expect(STORY_QC_RESPONSE_SCHEMA.required).toContain('agency');
    expect(STORY_QC_RESPONSE_SCHEMA.properties.soundOverload.type).toEqual(['boolean', 'null']);
    expect(STORY_QC_RESPONSE_SCHEMA.properties.agency.type).toBe('number');
  });
});

describe('STORY_QC_THRESHOLDS — agency threshold (log-only)', () => {
  it('carries a log-only minAgency threshold', () => {
    expect(STORY_QC_THRESHOLDS.minAgency).toBe(6);
  });
});

describe('story QC — judge shares the 3-5 adventure frame (S4 alignment)', () => {
  it('system prompt drops the toddler frame for ages 3-5 + the adventure north-star', () => {
    expect(STORY_QC_SYSTEM_PROMPT).toContain('ages 3-5');
    expect(STORY_QC_SYSTEM_PROMPT).toContain('a beginning, a problem, and a satisfying end');
    expect(STORY_QC_SYSTEM_PROMPT).not.toContain('toddlers (ages 2-4)');
  });

  it('QC body reviews an ages-3-5 manuscript, never a toddler one', () => {
    const prompt = createStoryQCPrompt({
      storyArc: arc,
      pages: [{ pageNumber: 1, text: 'Splish!' }],
    });
    expect(prompt).toContain('picture-book manuscript for children ages 3-5');
    expect(prompt).not.toContain('toddler picture-book manuscript');
  });
});

describe('countWords (en)', () => {
  it('counts whitespace-delimited words', () => {
    expect(countWords('Kai stands at the jungle gate.')).toBe(6);
    expect(countWords('Up, up, up!')).toBe(3);
  });

  it('counts dash-joined tokens as one word', () => {
    expect(countWords('one—two three')).toBe(2);
  });

  it('returns 0 for empty or whitespace text', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});

describe('countJaChars', () => {
  it('counts characters excluding whitespace and punctuation', () => {
    expect(countJaChars('ざぶーん！もういっかい。')).toBe(10);
    expect(countJaChars('みずが ざぶん')).toBe(6);
  });

  it('returns 0 for empty text', () => {
    expect(countJaChars('')).toBe(0);
    expect(countJaChars(' 。！ ')).toBe(0);
  });
});

describe('countSentences', () => {
  it('counts sentence-final marks (en)', () => {
    expect(countSentences('Kai pushes. Titan rolls. Trapjaw giggles.')).toBe(3);
    expect(countSentences('Up, up, up!')).toBe(1);
    expect(countSentences('Wait… what is that?')).toBe(2);
  });

  it('treats consecutive marks as one terminator', () => {
    expect(countSentences('What?!')).toBe(1);
  });

  it('counts unterminated non-empty text as one sentence', () => {
    expect(countSentences('goodnight little one')).toBe(1);
    expect(countSentences('')).toBe(0);
  });

  it('counts ja terminators', () => {
    expect(countSentences('ざぶーん！もういっかい。', 'ja')).toBe(2);
  });
});

describe('wordBudgetProblems', () => {
  const longText = Array(31).fill('word').join(' ');
  const choppy = 'Kai runs. Kai jumps. Kai spins. Kai naps.';

  it('flags en pages over the 30-word cap with counts in the issue', () => {
    const problems = wordBudgetProblems(
      [
        { pageNumber: 1, text: longText },
        { pageNumber: 2, text: 'Kai tiptoes over the bendy bridge.' },
      ],
      'en',
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].pageNumber).toBe(1);
    expect(problems[0].issue).toContain('31 words');
  });

  it('flags en pages over the 3-sentence cap', () => {
    const problems = wordBudgetProblems([{ pageNumber: 4, text: choppy }], 'en');
    expect(problems).toHaveLength(1);
    expect(problems[0].pageNumber).toBe(4);
    expect(problems[0].issue).toContain('4 sentences');
  });

  it('passes pages at exactly the caps', () => {
    const atCap = `${Array(27).fill('word').join(' ')}. Second one. Third!`;
    expect(countWords(atCap)).toBe(30);
    expect(wordBudgetProblems([{ pageNumber: 1, text: atCap }], 'en')).toEqual([]);
  });

  it('flags ja pages over the 48-char cap', () => {
    const longJa = 'あ'.repeat(49);
    const problems = wordBudgetProblems([{ pageNumber: 2, text: longJa }], 'ja');
    expect(problems).toHaveLength(1);
    expect(problems[0].issue).toContain('49 characters');
  });

  it('passes short ja pages', () => {
    expect(wordBudgetProblems([{ pageNumber: 1, text: 'ざぶーん！もういっかい。' }], 'ja')).toEqual(
      [],
    );
  });
});

describe('findNameGarbles', () => {
  const roster = ['Kai', 'Trapjaw', 'Titan', 'Trex', 'Dada'];

  it('flags two roster names joined by "the" (the shipped Trex-the-Kai bug)', () => {
    const garbles = findNameGarbles(
      [{ pageNumber: 6, text: 'Trex the Kai bursts out, yellow eye bright.' }],
      roster,
    );
    expect(garbles).toHaveLength(1);
    expect(garbles[0].pageNumber).toBe(6);
    expect(garbles[0].snippet).toBe('Trex the Kai');
  });

  it('flags directly adjacent distinct roster names', () => {
    const garbles = findNameGarbles([{ pageNumber: 2, text: 'Titan Kai runs fast.' }], roster);
    expect(garbles).toHaveLength(1);
    expect(garbles[0].snippet).toBe('Titan Kai');
  });

  it('matches case-insensitively', () => {
    const garbles = findNameGarbles([{ pageNumber: 1, text: 'and then trex the kai ran' }], roster);
    expect(garbles).toHaveLength(1);
  });

  it('ignores legit joins: and / comma lists / possessives / sentence breaks', () => {
    const pages = [
      { pageNumber: 1, text: 'Kai and Trapjaw run.' },
      { pageNumber: 2, text: 'He chases Kai, Trapjaw, and Titan toward the mountain.' },
      { pageNumber: 3, text: "Kai's Titan wiggles happily." },
      { pageNumber: 4, text: 'They cheer for Kai. Trapjaw claps loudly.' },
      { pageNumber: 5, text: 'Kai with Titan naps in the shade.' },
    ];
    expect(findNameGarbles(pages, roster)).toEqual([]);
  });

  it('never flags the same name repeated ("Kai the Kai" needs distinct names)', () => {
    expect(findNameGarbles([{ pageNumber: 1, text: 'Kai the Kai' }], roster)).toEqual([]);
  });

  it('skips ja books (no reliable word boundaries)', () => {
    expect(
      findNameGarbles([{ pageNumber: 1, text: 'えま の トレックス' }], ['えま', 'トレックス'], 'ja'),
    ).toEqual([]);
  });
});

describe('rollCallProblems (log-only)', () => {
  const roster = ['Kai', 'Trapjaw', 'Titan', 'Trex', 'Dada'];

  it('flags pages where more than 3 roster names appear', () => {
    const text = 'Trapjaw shines his arm, Titan wiggles, Dada holds the vines, and Kai steps.';
    const problems = rollCallProblems([{ pageNumber: 1, text }], roster);
    expect(problems).toHaveLength(1);
    expect(problems[0].namesFound).toHaveLength(4);
  });

  it('passes pages with 3 or fewer roster names', () => {
    const text = 'Trapjaw points ahead, and Titan sniffs the path while Kai watches.';
    expect(rollCallProblems([{ pageNumber: 1, text }], roster)).toEqual([]);
  });

  it('does not match names inside longer words', () => {
    const text = 'The titanic Kaiser dadaist trexcavator trapjawline.';
    expect(rollCallProblems([{ pageNumber: 1, text }], roster)).toEqual([]);
  });
});

describe('STORY_QC_THRESHOLDS — word budget caps', () => {
  it('carries the age-4 length caps', () => {
    expect(STORY_QC_THRESHOLDS.maxWordsEn).toBe(30);
    expect(STORY_QC_THRESHOLDS.maxSentences).toBe(3);
    expect(STORY_QC_THRESHOLDS.maxCharsJa).toBe(48);
  });
});

describe('QC v2 — beat-aware photo judge', () => {
  const beatSheet: BeatSheetEntry[] = [
    {
      pageNumber: 1,
      role: 'setup',
      goal: 'Plant the umbrella and the want',
      handoff: 'Rain starts',
    },
    {
      pageNumber: 2,
      role: 'resolution',
      goal: 'Teddy rescued with the umbrella',
      handoff: null,
    },
  ];
  const prompt = createStoryQCPrompt({
    storyArc: arc,
    pages: [
      { pageNumber: 1, text: 'Splish!' },
      { pageNumber: 2, text: 'Home.' },
    ],
    beatSheet,
  });

  it('renders the throughline in the declared-arc block', () => {
    expect(prompt).toContain('Throughline: Get teddy back');
  });

  it('annotates each page with its declared beat', () => {
    expect(prompt).toContain('--- Page 1 (beat: setup — Plant the umbrella and the want) ---');
    expect(prompt).toContain('--- Page 2 (beat: resolution — Teddy rescued with the umbrella) ---');
  });

  it('scores deliversBeat per page and enforces it in the fail line', () => {
    expect(prompt).toContain('deliversBeat');
    const failLine = prompt.split('\n').find((l) => l.startsWith('If ANY of these fail'));
    expect(failLine).toContain('deliversBeat');
    expect(STORY_QC_RESPONSE_SCHEMA.properties.pages.items.required).toContain('deliversBeat');
  });

  it('omits beat annotations when no beat sheet is provided', () => {
    const bare = createStoryQCPrompt({
      storyArc: arc,
      pages: [{ pageNumber: 1, text: 'Splish!' }],
    });
    expect(bare).toContain('--- Page 1 ---');
    expect(bare).not.toContain('(beat:');
  });
});

describe('QC v2 — avatar judge sees scenes and beats', () => {
  const prompt = createAvatarStoryQCPrompt({
    storyArc: arc,
    premise: 'A jungle map adventure',
    pages: [
      {
        pageNumber: 1,
        text: 'Kai finds a map.',
        sceneAction: 'Kai unfolds a crayon map at the jungle gate',
        sceneFocus: 'Kai holding the map',
      },
    ],
    beatSheet: [
      {
        pageNumber: 1,
        role: 'setup',
        goal: 'Plant the map',
        handoff: 'The map curls toward the trees',
      },
    ],
  });

  it('annotates pages with beat + scene action/focus', () => {
    expect(prompt).toContain('(beat: setup — Plant the map)');
    expect(prompt).toContain(
      '[scene action: Kai unfolds a crayon map at the jungle gate; focus: Kai holding the map]',
    );
  });

  it('scores sceneMatchesText and deliversBeat per page in the schema', () => {
    expect(prompt).toContain('sceneMatchesText');
    expect(prompt).toContain('deliversBeat');
    const req = AVATAR_STORY_QC_RESPONSE_SCHEMA.properties.pages.items.required;
    expect(req).toContain('sceneMatchesText');
    expect(req).toContain('deliversBeat');
  });

  it('enforces agency, deliversBeat, and sceneMatchesText in the fail line', () => {
    const failLine = prompt.split('\n').find((l) => l.startsWith('If ANY of these fail'));
    expect(failLine).toContain('agency < 6');
    expect(failLine).toContain('deliversBeat');
    expect(failLine).toContain('sceneMatchesText');
  });

  it('renders the throughline for the avatar judge too', () => {
    expect(prompt).toContain('Throughline: Get teddy back');
  });
});
