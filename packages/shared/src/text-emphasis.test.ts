import { describe, it, expect } from 'vitest';
import { splitEmphasisSegments } from './text-emphasis.js';

describe('splitEmphasisSegments', () => {
  it('returns one plain segment when no words are given', () => {
    expect(splitEmphasisSegments('Mia hugs her bunny.', [])).toEqual([
      { text: 'Mia hugs her bunny.', emphasized: false },
    ]);
  });

  it('emphasizes every occurrence of a Latin word on word boundaries', () => {
    const segments = splitEmphasisSegments('Splash! One more splash for Mia.', ['splash']);
    expect(segments).toEqual([
      { text: 'Splash', emphasized: true },
      { text: '! One more ', emphasized: false },
      { text: 'splash', emphasized: true },
      { text: ' for Mia.', emphasized: false },
    ]);
  });

  it('never lights up substrings of larger Latin words', () => {
    const segments = splitEmphasisSegments('The catalog shows a cat.', ['cat']);
    expect(segments.filter(s => s.emphasized).map(s => s.text)).toEqual(['cat']);
  });

  it('matches CJK words as exact substrings', () => {
    const segments = splitEmphasisSegments('あめのなか、かさをさして あるいたよ。', ['かさ']);
    expect(segments).toEqual([
      { text: 'あめのなか、', emphasized: false },
      { text: 'かさ', emphasized: true },
      { text: 'をさして あるいたよ。', emphasized: false },
    ]);
  });

  it('longer words win overlaps', () => {
    const segments = splitEmphasisSegments('Her raincoat kept the rain away.', ['rain', 'raincoat']);
    expect(segments.filter(s => s.emphasized).map(s => s.text)).toEqual(['raincoat', 'rain']);
  });

  it('round-trips: concatenated segments equal the input', () => {
    const text = 'Umbrella up! The umbrella dances in the rain.';
    const joined = splitEmphasisSegments(text, ['umbrella', 'rain']).map(s => s.text).join('');
    expect(joined).toBe(text);
  });
});
