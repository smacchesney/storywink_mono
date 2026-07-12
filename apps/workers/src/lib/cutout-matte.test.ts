import { describe, it, expect } from 'vitest';
import { matteWhiteBackground } from './cutout-matte.js';

const W = 255;

/** Build an RGBA buffer from a grid of single-letter cells: 'w' white, 'r' red, 'g' light gray. */
function image(rows: string[]): { data: Uint8Array; width: number; height: number } {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const cell = rows[y][x];
      if (cell === 'w') data.set([W, W, W, W], i);
      else if (cell === 'r') data.set([200, 30, 30, W], i);
      else if (cell === 'g') data.set([200, 200, 200, W], i);
      else throw new Error(`unknown cell ${cell}`);
    }
  }
  return { data, width, height };
}

function alphaAt(data: Uint8Array, width: number, x: number, y: number): number {
  return data[(y * width + x) * 4 + 3];
}

describe('matteWhiteBackground', () => {
  it('clears border-connected white and keeps the subject opaque', () => {
    const { data, width, height } = image([
      'wwwwww',
      'wwwwww',
      'wwrrww',
      'wwrrww',
      'wwwwww',
      'wwwwww',
    ]);
    const { backgroundRatio } = matteWhiteBackground(data, width, height, { featherRadius: 0 });
    expect(alphaAt(data, width, 0, 0)).toBe(0); // corner background gone
    expect(alphaAt(data, width, 5, 5)).toBe(0);
    expect(alphaAt(data, width, 2, 2)).toBe(255); // subject untouched
    expect(alphaAt(data, width, 3, 3)).toBe(255);
    expect(backgroundRatio).toBeCloseTo(32 / 36, 5);
  });

  it('never hole-punches enclosed white (white clothing stays opaque)', () => {
    const { data, width, height } = image([
      'wwwwww',
      'wrrrrw',
      'wrwwrw',
      'wrwwrw',
      'wrrrrw',
      'wwwwww',
    ]);
    matteWhiteBackground(data, width, height, { featherRadius: 0 });
    // The white "shirt" enclosed by red is not border-connected — kept.
    expect(alphaAt(data, width, 2, 2)).toBe(255);
    expect(alphaAt(data, width, 3, 3)).toBe(255);
    // The border ring is background.
    expect(alphaAt(data, width, 0, 3)).toBe(0);
  });

  it('leaves a non-white background alone (ratio 0 → caller keeps the white fallback)', () => {
    const { data, width, height } = image(['gggg', 'grrg', 'grrg', 'gggg']);
    const { backgroundRatio } = matteWhiteBackground(data, width, height, { featherRadius: 0 });
    expect(backgroundRatio).toBe(0);
    expect(alphaAt(data, width, 0, 0)).toBe(255);
  });

  it('feathers the edge: subject pixels adjacent to background get partial alpha', () => {
    const { data, width, height } = image(['wwwww', 'wwwww', 'wwrww', 'wwwww', 'wwwww']);
    matteWhiteBackground(data, width, height, { featherRadius: 1 });
    const center = alphaAt(data, width, 2, 2);
    expect(center).toBeGreaterThan(0);
    expect(center).toBeLessThan(255); // 1px subject is all edge — softened
    expect(alphaAt(data, width, 0, 0)).toBe(0); // far background fully clear
  });

  it('reaches white pockets connected to the border through a gap', () => {
    const { data, width, height } = image([
      'wwwwww',
      'wrrrrw',
      'wrwwrw',
      'wrwwrw',
      'wrrwrw', // gap at x=3 — the pocket drains to the border
      'wwwwww',
    ]);
    matteWhiteBackground(data, width, height, { featherRadius: 0 });
    expect(alphaAt(data, width, 2, 2)).toBe(0);
    expect(alphaAt(data, width, 3, 3)).toBe(0);
  });

  it('rejects malformed input', () => {
    expect(() => matteWhiteBackground(new Uint8Array(10), 2, 2)).toThrow();
  });
});
