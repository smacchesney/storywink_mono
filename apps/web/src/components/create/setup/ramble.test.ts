import { describe, it, expect } from 'vitest';
import { clampRamble, shouldExtract, RAMBLE_MAX_CHARS, RAMBLE_EXTRACT_MIN_CHARS } from './ramble';

describe('clampRamble', () => {
  it('caps at 1500 chars', () => {
    expect(RAMBLE_MAX_CHARS).toBe(1500);
    expect(clampRamble('a'.repeat(2000))).toHaveLength(1500);
    expect(clampRamble('short')).toBe('short');
  });
});

describe('shouldExtract', () => {
  const long = 'x'.repeat(RAMBLE_EXTRACT_MIN_CHARS);
  it('needs the minimum length', () => {
    expect(shouldExtract('too short', null)).toBe(false);
    expect(shouldExtract(long, null)).toBe(true);
  });
  it('skips an unchanged ramble', () => {
    expect(shouldExtract(long, long)).toBe(false);
    expect(shouldExtract(` ${long} `, long)).toBe(false);
    expect(shouldExtract(`${long}!`, long)).toBe(true);
  });
});
