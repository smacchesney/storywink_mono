import { describe, it, expect } from 'vitest';
import { getAllStyleKeys } from '@storywink/shared/prompts/styles';
import { styleLabelKey } from './styleLabelKey';

describe('styleLabelKey', () => {
  it('maps each style to its setup-namespace label key', () => {
    expect(styleLabelKey('vignette')).toBe('styleVignette');
    expect(styleLabelKey('origami')).toBe('styleOrigami');
    expect(styleLabelKey('kawaii')).toBe('styleKawaii');
  });

  it('covers every style in STYLE_LIBRARY (a new style must add a label)', () => {
    for (const key of getAllStyleKeys()) {
      expect(styleLabelKey(key)).toMatch(/^style/);
    }
  });
});
