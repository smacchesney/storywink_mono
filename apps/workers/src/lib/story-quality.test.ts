import { describe, it, expect } from 'vitest';
import {
  storyQualityV2Enabled,
  storyIllusMoodEnabled,
  photoComeAliveEnabled,
  deterministicStoryChecks,
} from './story-quality.js';

describe('storyQualityV2Enabled', () => {
  it('reads the STORY_QUALITY_V2 env flag', () => {
    expect(storyQualityV2Enabled({ STORY_QUALITY_V2: 'true' })).toBe(true);
    expect(storyQualityV2Enabled({ STORY_QUALITY_V2: '1' })).toBe(true);
    expect(storyQualityV2Enabled({ STORY_QUALITY_V2: 'false' })).toBe(false);
    expect(storyQualityV2Enabled({ STORY_QUALITY_V2: '' })).toBe(false);
    expect(storyQualityV2Enabled({})).toBe(false);
  });
});

describe('storyIllusMoodEnabled', () => {
  it('reads the STORY_ILLUS_MOOD_ENABLED env flag', () => {
    expect(storyIllusMoodEnabled({ STORY_ILLUS_MOOD_ENABLED: 'true' })).toBe(true);
    expect(storyIllusMoodEnabled({ STORY_ILLUS_MOOD_ENABLED: 'false' })).toBe(false);
    expect(storyIllusMoodEnabled({})).toBe(false);
  });
});

describe('photoComeAliveEnabled', () => {
  it('defaults off and honors true/1', () => {
    expect(photoComeAliveEnabled({})).toBe(false);
    expect(photoComeAliveEnabled({ PHOTO_COME_ALIVE_ENABLED: 'true' })).toBe(true);
    expect(photoComeAliveEnabled({ PHOTO_COME_ALIVE_ENABLED: '1' })).toBe(true);
    expect(photoComeAliveEnabled({ PHOTO_COME_ALIVE_ENABLED: 'false' })).toBe(false);
  });
});

describe('deterministicStoryChecks', () => {
  const roster = ['Kai', 'Trex'];

  it('flags word-budget and garble problems as enforceable strings (en)', () => {
    const pages = [
      { pageNumber: 1, text: Array(31).fill('word').join(' ') },
      { pageNumber: 2, text: 'Trex the Kai bursts out.' },
    ];
    const checks = deterministicStoryChecks(pages, roster, 'en');
    expect(checks.problems).toHaveLength(2);
    expect(checks.problems[0]).toContain('31 words');
    expect(checks.problems[1]).toContain('Trex the Kai');
    expect(checks.offendingPages).toEqual([1, 2]);
  });

  it('keeps ja budget violations out of problems (log-only until calibration)', () => {
    const pages = [{ pageNumber: 1, text: 'あ'.repeat(60) }];
    const checks = deterministicStoryChecks(pages, [], 'ja');
    expect(checks.budget).toHaveLength(1);
    expect(checks.problems).toEqual([]);
    expect(checks.offendingPages).toEqual([]);
  });

  it('reports roll-call pages as log-only info, never blocking', () => {
    const pages = [
      { pageNumber: 3, text: 'Kai hops, Trex stomps, Dada laughs, and Titan rolls along.' },
    ];
    const checks = deterministicStoryChecks(pages, ['Kai', 'Trex', 'Dada', 'Titan'], 'en');
    expect(checks.rollCall).toHaveLength(1);
    expect(checks.problems).toEqual([]);
  });

  it('passes clean pages', () => {
    const checks = deterministicStoryChecks(
      [{ pageNumber: 1, text: 'Kai tiptoes over the bendy bridge.' }],
      roster,
      'en',
    );
    expect(checks.problems).toEqual([]);
    expect(checks.offendingPages).toEqual([]);
  });

  it('dedupes offendingPages when one page violates twice', () => {
    const pages = [{ pageNumber: 5, text: `${Array(29).fill('word').join(' ')} Trex the Kai.` }];
    const checks = deterministicStoryChecks(pages, roster, 'en');
    expect(checks.offendingPages).toEqual([5]);
  });
});
