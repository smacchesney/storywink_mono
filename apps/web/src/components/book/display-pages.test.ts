import { describe, it, expect } from 'vitest';
import {
  buildDisplayPages,
  remapDisplayIndex,
  type DisplayPage,
  type DisplaySourcePage,
} from './display-pages';

function makePage(overrides: Partial<DisplaySourcePage> & { id: string }): DisplaySourcePage {
  return {
    pageNumber: 1,
    text: 'Once upon a time.',
    isTitlePage: false,
    generatedImageUrl: `https://res.cloudinary.com/x/image/upload/v1/${overrides.id}.png`,
    ...overrides,
  };
}

/** A typical book: 1 title page + N story pages with text. */
function makeBook(storyCount: number): DisplaySourcePage[] {
  const title = makePage({ id: 'title', pageNumber: 1, isTitlePage: true, text: null });
  const stories = Array.from({ length: storyCount }, (_, i) =>
    makePage({ id: `story-${i + 1}`, pageNumber: i + 2, text: `Beat ${i + 1}.` })
  );
  return [title, ...stories];
}

const typeSeq = (dps: DisplayPage[]) => dps.map((dp) => dp.type);

describe('buildDisplayPages — spread (default, print-faithful)', () => {
  it('keeps the existing layout for a 10-photo book: 27 entries', () => {
    const dps = buildDisplayPages(makeBook(10));
    // 3 front matter + 1 title story beat + 10×2 story pairs + 3 back matter
    expect(dps).toHaveLength(27);
    // Front matter, then the title page's own beat (no text), then pairs
    expect(typeSeq(dps).slice(0, 6)).toEqual([
      'illustration',
      'blank',
      'dedication',
      'illustration',
      'text',
      'illustration',
    ]);
    expect(typeSeq(dps).slice(-3)).toEqual(['ending', 'blank', 'back-cover']);
  });

  it('defaults to spread when layout is omitted', () => {
    const explicit = buildDisplayPages(makeBook(3), { layout: 'spread' });
    const implicit = buildDisplayPages(makeBook(3));
    expect(typeSeq(explicit)).toEqual(typeSeq(implicit));
  });

  it('repeats the title page as a story beat (no text page for it)', () => {
    const dps = buildDisplayPages(makeBook(2));
    const titleBeats = dps.filter((dp) => dp.type === 'illustration' && dp.page.isTitlePage);
    expect(titleBeats).toHaveLength(2); // cover slot + story beat
  });
});

describe('buildDisplayPages — portrait (combined pages)', () => {
  it('emits cover / dedication / N stories / ending / back-cover with no blanks', () => {
    const dps = buildDisplayPages(makeBook(10), { layout: 'portrait' });
    // 14 entries = 13 flips for a 10-photo book (was 25 flips in spread order)
    expect(dps).toHaveLength(14);
    expect(typeSeq(dps)).toEqual([
      'illustration',
      'dedication',
      ...Array(10).fill('story'),
      'ending',
      'back-cover',
    ]);
    expect(dps.some((dp) => dp.type === 'blank')).toBe(false);
  });

  it('excludes the title page from story beats (it fronts the book already)', () => {
    const dps = buildDisplayPages(makeBook(3), { layout: 'portrait' });
    const stories = dps.filter((dp) => dp.type === 'story');
    expect(stories).toHaveLength(3);
    expect(stories.every((dp) => dp.type === 'story' && !dp.page.isTitlePage)).toBe(true);
  });

  it('keeps story order and carries language through', () => {
    const dps = buildDisplayPages(makeBook(2), { layout: 'portrait', language: 'ja' });
    const stories = dps.filter((dp) => dp.type === 'story');
    expect(stories.map((dp) => (dp.type === 'story' ? dp.page.id : ''))).toEqual(['story-1', 'story-2']);
    expect(stories.every((dp) => dp.type === 'story' && dp.language === 'ja')).toBe(true);
  });

  it('handles a book without a title page: stories only, no cover or dedication', () => {
    const pages = [makePage({ id: 'a' }), makePage({ id: 'b' })];
    const dps = buildDisplayPages(pages, { layout: 'portrait' });
    expect(typeSeq(dps)).toEqual(['story', 'story', 'ending', 'back-cover']);
  });

  it('keeps pages without text as combined pages (empty strip, uniform flips)', () => {
    const pages = [
      makePage({ id: 'title', isTitlePage: true, text: null }),
      makePage({ id: 'quiet', text: null }),
    ];
    const dps = buildDisplayPages(pages, { layout: 'portrait' });
    expect(typeSeq(dps)).toEqual(['illustration', 'dedication', 'story', 'ending', 'back-cover']);
  });
});

describe('remapDisplayIndex — rotation keeps the reader on the same beat', () => {
  const book = makeBook(10);
  const spread = buildDisplayPages(book);
  const portrait = buildDisplayPages(book, { layout: 'portrait' });

  it('cover maps to cover, both directions', () => {
    expect(remapDisplayIndex(spread, 0, portrait)).toBe(0);
    expect(remapDisplayIndex(portrait, 0, spread)).toBe(0);
  });

  it('dedication, ending and back cover map to themselves', () => {
    expect(remapDisplayIndex(spread, 2, portrait)).toBe(1); // dedication
    expect(remapDisplayIndex(portrait, 1, spread)).toBe(2);
    const spreadEnding = spread.findIndex((dp) => dp.type === 'ending');
    const portraitEnding = portrait.findIndex((dp) => dp.type === 'ending');
    expect(remapDisplayIndex(spread, spreadEnding, portrait)).toBe(portraitEnding);
    expect(remapDisplayIndex(portrait, portrait.length - 1, spread)).toBe(spread.length - 1); // back cover
  });

  it('a spread text verso maps to its combined story page', () => {
    const textIdx = spread.findIndex((dp) => dp.type === 'text' && dp.page.id === 'story-4');
    const storyIdx = portrait.findIndex((dp) => dp.type === 'story' && dp.page.id === 'story-4');
    expect(remapDisplayIndex(spread, textIdx, portrait)).toBe(storyIdx);
  });

  it('a spread illustration maps to the beat its visible pair is reading', () => {
    const illusIdx = spread.findIndex((dp) => dp.type === 'illustration' && !dp.page.isTitlePage && dp.page.id === 'story-7');
    // With the title beat in the loop this illustration is a LEFT page whose
    // right-hand neighbour is the NEXT beat's text — that text is the beat
    // on screen, so the remap anchors there.
    expect(illusIdx % 2).toBe(1);
    const rightText = spread[illusIdx + 1];
    expect(rightText.type).toBe('text');
    const anchorId = rightText.type === 'text' ? rightText.page.id : '';
    const storyIdx = portrait.findIndex((dp) => dp.type === 'story' && dp.page.id === anchorId);
    expect(remapDisplayIndex(spread, illusIdx, portrait)).toBe(storyIdx);
  });

  it('a combined story page maps back to its spread text verso (start of the pair)', () => {
    const storyIdx = portrait.findIndex((dp) => dp.type === 'story' && dp.page.id === 'story-4');
    const textIdx = spread.findIndex((dp) => dp.type === 'text' && dp.page.id === 'story-4');
    expect(remapDisplayIndex(portrait, storyIdx, spread)).toBe(textIdx);
  });

  it('the inside-front blank lands on the dedication (nearest forward beat)', () => {
    expect(remapDisplayIndex(spread, 1, portrait)).toBe(1); // blank → dedication
  });

  it("the title page's spread-only story beat lands on the nearest portrait story", () => {
    // spread: [0 cover] [1 blank] [2 dedication] [3 illustration(title beat)] [4 text story-1] ...
    const titleBeatIdx = 3;
    expect(spread[titleBeatIdx].type).toBe('illustration');
    const firstStoryIdx = portrait.findIndex((dp) => dp.type === 'story' && dp.page.id === 'story-1');
    expect(remapDisplayIndex(spread, titleBeatIdx, portrait)).toBe(firstStoryIdx);
  });

  it('the ending-pad blank maps near the ending', () => {
    const padIdx = spread.length - 2; // blank between ending and back cover
    expect(spread[padIdx].type).toBe('blank');
    const backIdx = portrait.findIndex((dp) => dp.type === 'back-cover');
    expect(remapDisplayIndex(spread, padIdx, portrait)).toBe(backIdx);
  });

  it('anchors on the text when the engine reports the left page of a shifted pair', () => {
    // With the title beat in the loop, spreads pair as
    // [illustration(story-N) | text(story-N+1)]. The flip engine reports the
    // LEFT index; the reader is reading the RIGHT page's text.
    const textIdx = spread.findIndex((dp) => dp.type === 'text' && dp.page.id === 'story-2');
    const leftIdx = textIdx - 1; // illustration of story-1
    expect(spread[leftIdx].type).toBe('illustration');
    expect(leftIdx % 2).toBe(1); // left page of a pair
    const storyIdx = portrait.findIndex((dp) => dp.type === 'story' && dp.page.id === 'story-2');
    expect(remapDisplayIndex(spread, leftIdx, portrait)).toBe(storyIdx);
  });

  it('round-trips a beat through rotation with left-page reporting', () => {
    const storyIdx = portrait.findIndex((dp) => dp.type === 'story' && dp.page.id === 'story-5');
    const spreadIdx = remapDisplayIndex(portrait, storyIdx, spread);
    // The engine shows the spread containing spreadIdx and reports its left
    // page; for an even (right) index that is the entry just before it.
    const reported = spreadIdx % 2 === 0 ? spreadIdx - 1 : spreadIdx;
    expect(remapDisplayIndex(spread, reported, portrait)).toBe(storyIdx);
  });

  it('clamps out-of-range indices instead of throwing', () => {
    expect(remapDisplayIndex(spread, 999, portrait)).toBe(portrait.length - 1);
    expect(remapDisplayIndex(spread, -5, portrait)).toBe(0);
    expect(remapDisplayIndex([], 3, portrait)).toBe(3);
    expect(remapDisplayIndex(spread, 3, [])).toBe(0);
  });

  it('a story page for a page missing from the other layout falls back to a neighbour', () => {
    const shortBook = makeBook(2);
    const fromPortrait = buildDisplayPages(shortBook, { layout: 'portrait' });
    // Remove story-2 from the target book entirely
    const target = buildDisplayPages(
      shortBook.filter((p) => p.id !== 'story-2'),
      { layout: 'spread' }
    );
    const story2Idx = fromPortrait.findIndex((dp) => dp.type === 'story' && dp.page.id === 'story-2');
    const endingIdx = target.findIndex((dp) => dp.type === 'ending');
    // Forward bias: the next beat after story-2 is the ending
    expect(remapDisplayIndex(fromPortrait, story2Idx, target)).toBe(endingIdx);
  });
});
