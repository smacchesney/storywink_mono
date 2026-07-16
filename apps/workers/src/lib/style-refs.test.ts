import { describe, expect, it } from 'vitest';
import { capStyleRefs, styleRefsMax } from './style-refs.js';

describe('styleRefsMax', () => {
  it('is null (current behavior) when the env var is unset or empty', () => {
    expect(styleRefsMax({})).toBeNull();
    expect(styleRefsMax({ ILLUSTRATION_STYLE_REFS_MAX: '' })).toBeNull();
    expect(styleRefsMax({ ILLUSTRATION_STYLE_REFS_MAX: '  ' })).toBeNull();
  });

  it('parses non-negative integers ("0" means send no style-ref images)', () => {
    expect(styleRefsMax({ ILLUSTRATION_STYLE_REFS_MAX: '0' })).toBe(0);
    expect(styleRefsMax({ ILLUSTRATION_STYLE_REFS_MAX: '1' })).toBe(1);
    expect(styleRefsMax({ ILLUSTRATION_STYLE_REFS_MAX: '2' })).toBe(2);
  });

  it('rejects garbage, negatives, and fractions (null = current behavior)', () => {
    expect(styleRefsMax({ ILLUSTRATION_STYLE_REFS_MAX: 'zero' })).toBeNull();
    expect(styleRefsMax({ ILLUSTRATION_STYLE_REFS_MAX: '-1' })).toBeNull();
    expect(styleRefsMax({ ILLUSTRATION_STYLE_REFS_MAX: '1.5' })).toBeNull();
  });
});

describe('capStyleRefs', () => {
  const urls = ['a', 'b', 'c'];

  it('returns the list untouched when the cap is null (flag unset)', () => {
    expect(capStyleRefs(urls, null)).toEqual(['a', 'b', 'c']);
  });

  it('slices to the cap, including to zero', () => {
    expect(capStyleRefs(urls, 2)).toEqual(['a', 'b']);
    expect(capStyleRefs(urls, 0)).toEqual([]);
  });

  it('a cap above the length is a no-op', () => {
    expect(capStyleRefs(urls, 5)).toEqual(['a', 'b', 'c']);
  });
});
