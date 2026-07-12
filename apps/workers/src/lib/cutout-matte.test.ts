import { describe, it, expect } from 'vitest';
import { matteWhiteBackground, isUsableMatte } from './cutout-matte.js';

const W = 255;

/**
 * Build an RGBA buffer from a grid of single-letter cells:
 * 'w' pure white, 'n' near-white 245 (above the 235 floor), 'o' off-white 230
 * (below the floor), 'r' red, 'g' light gray.
 */
function image(rows: string[]): { data: Uint8Array; width: number; height: number } {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const cell = rows[y][x];
      if (cell === 'w') data.set([W, W, W, W], i);
      else if (cell === 'n') data.set([245, 245, 245, W], i);
      else if (cell === 'o') data.set([230, 230, 230, W], i);
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

  // Gemini's "pure white" is near-white in practice (anti-aliasing, JPEG-ish
  // artifacts) — the 235 floor is what makes real backgrounds clear at all.
  it('clears a near-white (245) background — the whiteFloor is not exact-255 matching', () => {
    const { data, width, height } = image(['nnnn', 'nrrn', 'nrrn', 'nnnn']);
    const { backgroundRatio } = matteWhiteBackground(data, width, height, { featherRadius: 0 });
    expect(backgroundRatio).toBeCloseTo(12 / 16, 5);
    expect(alphaAt(data, width, 0, 0)).toBe(0);
    expect(alphaAt(data, width, 1, 1)).toBe(255);
  });

  it('leaves an off-white (230, below the floor) background alone', () => {
    const { data, width, height } = image(['oooo', 'orro', 'orro', 'oooo']);
    const { backgroundRatio } = matteWhiteBackground(data, width, height, { featherRadius: 0 });
    expect(backgroundRatio).toBe(0);
    expect(alphaAt(data, width, 0, 0)).toBe(255);
  });

  it('honors a whiteFloor override', () => {
    const { data, width, height } = image(['oooo', 'orro', 'orro', 'oooo']);
    const { backgroundRatio } = matteWhiteBackground(data, width, height, {
      featherRadius: 0,
      whiteFloor: 225,
    });
    expect(backgroundRatio).toBeCloseTo(12 / 16, 5);
    expect(alphaAt(data, width, 0, 0)).toBe(0);
  });

  // A figure spanning edge to edge splits the background into disconnected
  // pockets — every border side must seed, or a pocket ships as a white slab.
  it('clears background pockets split by a full-width subject (all four borders seed)', () => {
    const { data, width, height } = image(['wwww', 'rrrr', 'wwww']);
    const { backgroundRatio } = matteWhiteBackground(data, width, height, { featherRadius: 0 });
    expect(alphaAt(data, width, 0, 0)).toBe(0); // top pocket
    expect(alphaAt(data, width, 0, 2)).toBe(0); // bottom pocket
    expect(alphaAt(data, width, 3, 2)).toBe(0);
    expect(alphaAt(data, width, 1, 1)).toBe(255); // subject intact
    expect(backgroundRatio).toBeCloseTo(8 / 12, 5);
  });

  it('a vertical full-height subject leaves left/right pockets — both clear', () => {
    const { data, width, height } = image(['wrw', 'wrw', 'wrw']);
    matteWhiteBackground(data, width, height, { featherRadius: 0 });
    expect(alphaAt(data, width, 0, 1)).toBe(0);
    expect(alphaAt(data, width, 2, 1)).toBe(0);
    expect(alphaAt(data, width, 1, 1)).toBe(255);
  });

  // The "figure eaten" extreme the MatteResult doc warns callers about.
  it('all-white input yields ratio 1 and full transparency', () => {
    const { data, width, height } = image(['www', 'www', 'www']);
    const { backgroundRatio, largestForegroundShare } = matteWhiteBackground(data, width, height, {
      featherRadius: 0,
    });
    expect(backgroundRatio).toBe(1);
    expect(largestForegroundShare).toBe(1); // vacuous: no foreground at all
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) expect(alphaAt(data, width, x, y)).toBe(0);
  });

  // A near-white garment ON the silhouette drains to the border and severs
  // the figure — the fragmentation signal the global ratio cannot see.
  it('reports a fragmented foreground when a near-white garment punches through the silhouette', () => {
    const healthy = image(['wwwww', 'wrrrw', 'wrrrw', 'wrrrw', 'wwwww']);
    const healthyResult = matteWhiteBackground(healthy.data, healthy.width, healthy.height, {
      featherRadius: 0,
    });
    expect(healthyResult.largestForegroundShare).toBe(1);

    // The middle band is a near-white "shirt" touching the background on the
    // left edge of the figure: the fill drains it, splitting head from legs.
    const punched = image(['wwwww', 'wrrrw', 'wnnnw', 'wrrrw', 'wwwww']);
    const punchedResult = matteWhiteBackground(punched.data, punched.width, punched.height, {
      featherRadius: 0,
    });
    expect(alphaAt(punched.data, punched.width, 2, 2)).toBe(0); // shirt eaten
    expect(punchedResult.largestForegroundShare).toBeCloseTo(0.5, 5); // two equal halves
    expect(
      isUsableMatte({
        backgroundRatio: punchedResult.backgroundRatio,
        largestForegroundShare: punchedResult.largestForegroundShare,
      }),
    ).toBe(false);
  });
});

describe('isUsableMatte', () => {
  const intact = { largestForegroundShare: 1 };
  it('pins the accept band for the stored transparent variant', () => {
    expect(isUsableMatte({ backgroundRatio: 0, ...intact })).toBe(false);
    expect(isUsableMatte({ backgroundRatio: 0.04, ...intact })).toBe(false);
    expect(isUsableMatte({ backgroundRatio: 0.05, ...intact })).toBe(true);
    expect(isUsableMatte({ backgroundRatio: 0.7, ...intact })).toBe(true);
    expect(isUsableMatte({ backgroundRatio: 0.95, ...intact })).toBe(true);
    expect(isUsableMatte({ backgroundRatio: 0.96, ...intact })).toBe(false);
    expect(isUsableMatte({ backgroundRatio: 1, ...intact })).toBe(false);
  });
  it('rejects a fragmented foreground even inside the ratio band', () => {
    expect(isUsableMatte({ backgroundRatio: 0.7, largestForegroundShare: 0.89 })).toBe(false);
    expect(isUsableMatte({ backgroundRatio: 0.7, largestForegroundShare: 0.9 })).toBe(true);
  });
});
