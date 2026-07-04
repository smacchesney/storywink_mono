import { describe, it, expect } from 'vitest';
import { countRefrainEchoes } from './story-check.js';

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
