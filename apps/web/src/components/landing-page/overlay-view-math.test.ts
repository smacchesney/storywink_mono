import { describe, it, expect } from 'vitest';
import { buildDisplayPages } from '../book/display-pages';
import { computeViewState, computeDots } from './overlay-view-math';

function makePages(storyPages: number) {
  return [
    {
      id: 'title',
      pageNumber: 1,
      isTitlePage: true,
      generatedImageUrl: 'https://example.com/cover.png',
      text: null,
    },
    ...Array.from({ length: storyPages }, (_, i) => ({
      id: `p${i + 2}`,
      pageNumber: i + 2,
      isTitlePage: false,
      generatedImageUrl: `https://example.com/p${i + 2}.png`,
      text: `Page ${i + 2}`,
    })),
  ];
}

const OPTS = { childName: 'Kai', bookTitle: 'Kai at Rottenest Island' };

describe('computeViewState', () => {
  it('portrait and spread agree on total views for the same book', () => {
    for (const storyPages of [13, 15, 22]) {
      const pages = makePages(storyPages);
      const portraitCount = buildDisplayPages(pages, { ...OPTS, layout: 'portrait' }).length;
      const spreadCount = buildDisplayPages(pages, { ...OPTS, layout: 'spread' }).length;
      const portrait = computeViewState('portrait', portraitCount, 0);
      const spread = computeViewState('spread', spreadCount, 0);
      expect(spread.totalViews).toBe(portrait.totalViews);
    }
  });

  it('reaches the end exactly on the last display page in both layouts', () => {
    const pages = makePages(15); // 16 bookPages, like Kai at Rottenest Island
    for (const layout of ['portrait', 'spread'] as const) {
      const count = buildDisplayPages(pages, { ...OPTS, layout }).length;
      expect(computeViewState(layout, count, count - 1).isAtEnd).toBe(true);
      expect(computeViewState(layout, count, count - 2).isAtEnd).toBe(layout === 'spread');
      expect(computeViewState(layout, count, 0).isAtEnd).toBe(false);
      expect(computeViewState(layout, count, 0).currentView).toBe(0);
    }
  });

  it('spread pairs map to single views (cover alone, then two-up)', () => {
    expect(computeViewState('spread', 9, 0).currentView).toBe(0);
    expect(computeViewState('spread', 9, 1).currentView).toBe(1);
    expect(computeViewState('spread', 9, 2).currentView).toBe(1);
    expect(computeViewState('spread', 9, 3).currentView).toBe(2);
    expect(computeViewState('spread', 9, 8).currentView).toBe(4);
    expect(computeViewState('spread', 9, 8).totalViews).toBe(5);
  });

  it('handles the empty book without dividing by zero', () => {
    expect(computeViewState('portrait', 0, 0)).toEqual({
      totalViews: 0,
      currentView: 0,
      isAtEnd: false,
    });
  });
});

describe('computeDots', () => {
  it('never renders more than the cap', () => {
    expect(computeDots(19, 0).dotCount).toBe(12);
    expect(computeDots(19, 18).dotCount).toBe(12);
  });

  it('renders true per-view dots for short books', () => {
    expect(computeDots(9, 4)).toEqual({ dotCount: 9, activeDot: 4 });
  });

  it('first view lights only the first dot; last view always the last', () => {
    expect(computeDots(19, 0).activeDot).toBe(0);
    expect(computeDots(19, 18).activeDot).toBe(11);
  });

  it('is monotonic across a full read-through', () => {
    let last = -1;
    for (let view = 0; view < 19; view++) {
      const { activeDot } = computeDots(19, view);
      expect(activeDot).toBeGreaterThanOrEqual(last);
      last = activeDot;
    }
    expect(last).toBe(11);
  });

  it('single-view book keeps the first dot lit', () => {
    expect(computeDots(1, 0)).toEqual({ dotCount: 1, activeDot: 0 });
  });
});
