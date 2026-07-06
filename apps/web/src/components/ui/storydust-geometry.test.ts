import { describe, it, expect } from 'vitest';
import {
  CLOUD,
  CLOUD_VIEWBOX,
  DUST_STARS,
  PENCIL_PATH,
  SPARK4,
  STAR5,
  TWINKLE_STARS,
  cloudWidthPx,
  pencilBoxPx,
  pencilDashoffset,
  storydustWrapperClasses,
  twinkleStarPx,
  type StorydustSize,
  type StorydustVariant,
} from './storydust-geometry';

const SIZES: StorydustSize[] = ['inline', 'card', 'hero'];
const VARIANTS: StorydustVariant[] = ['twinkle', 'pencil', 'dust', 'cloud'];

describe('shape library', () => {
  it('exports the spec shapes verbatim', () => {
    expect(SPARK4).toBe(
      'M12 2.2 L13.7 10.3 L21.8 12 L13.6 13.8 L12 21.8 L10.2 13.6 L2.2 12 L10.4 10.4 Z',
    );
    expect(STAR5).toBe('M12 2l2.4 7.4H22l-6 4.6 2.3 7L12 17l-6.3 4 2.3-7-6-4.6h7.6L12 2z');
    expect(CLOUD.startsWith('M30 52c-11 0-20-9-20-20')).toBe(true);
    expect(CLOUD_VIEWBOX).toBe('0 0 120 60');
    expect(PENCIL_PATH).toBe('M4 11 q8 -5 16 -2 t16 1 t16 -3 t16 1 t16 -1');
  });
});

describe('twinkleStarPx', () => {
  it('maps inline to the 5/7/5 spec cluster and scales card up', () => {
    expect(twinkleStarPx('inline')).toEqual({ outer: 5, mid: 7 });
    expect(twinkleStarPx('card')).toEqual({ outer: 15, mid: 21 });
  });

  it('keeps the middle star ~25% larger at every size', () => {
    for (const size of SIZES) {
      const { outer, mid } = twinkleStarPx(size);
      expect(mid).toBeGreaterThan(outer);
      expect(mid / outer).toBeCloseTo(1.4, 1);
    }
  });
});

describe('pencilBoxPx', () => {
  it('matches the spec raster sizes (viewBox stays 96x16)', () => {
    expect(pencilBoxPx('card')).toEqual({ width: 96, height: 16 });
    expect(pencilBoxPx('hero')).toEqual({ width: 192, height: 32 });
  });

  it('preserves the 6:1 viewBox aspect at every size', () => {
    for (const size of SIZES) {
      const { width, height } = pencilBoxPx(size);
      expect(width / height).toBe(6);
    }
  });
});

describe('cloudWidthPx', () => {
  it('scales 48 / 96 / 160 across sizes', () => {
    expect(SIZES.map(cloudWidthPx)).toEqual([48, 96, 160]);
  });
});

describe('pencilDashoffset', () => {
  it('runs from the full guide (100) to fully drawn (0)', () => {
    expect(pencilDashoffset(0)).toBe(100);
    expect(pencilDashoffset(0.25)).toBe(75);
    expect(pencilDashoffset(1)).toBe(0);
  });

  it('clamps out-of-range progress instead of over/under-drawing', () => {
    expect(pencilDashoffset(-0.5)).toBe(100);
    expect(pencilDashoffset(1.7)).toBe(0);
  });
});

describe('storydustWrapperClasses', () => {
  it('gives working variants paint containment; the drifting cloud none', () => {
    for (const variant of VARIANTS) {
      const classes = storydustWrapperClasses(variant, 'card');
      if (variant === 'cloud') {
        expect(classes).not.toContain('[contain:paint]');
      } else {
        expect(classes).toContain('[contain:paint]');
      }
    }
  });

  it('defaults twinkle and dust to the brand coral via currentColor', () => {
    expect(storydustWrapperClasses('twinkle', 'inline')).toContain('text-coral');
    expect(storydustWrapperClasses('dust', 'hero')).toContain('text-coral');
  });

  it('stacks card/hero labels under the motif but keeps inline in a row', () => {
    expect(storydustWrapperClasses('twinkle', 'inline')).not.toContain('flex-col');
    expect(storydustWrapperClasses('twinkle', 'card')).toContain('flex-col');
    expect(storydustWrapperClasses('pencil', 'hero')).toContain('flex-col');
  });

  it('keeps scenery variants out of the pointer path', () => {
    expect(storydustWrapperClasses('dust', 'hero')).toContain('pointer-events-none');
    expect(storydustWrapperClasses('cloud', 'hero')).toContain('pointer-events-none');
  });
});

describe('compositions', () => {
  it('winks with a 0.2s stagger, middle star leading upright', () => {
    expect(TWINKLE_STARS).toHaveLength(3);
    expect(TWINKLE_STARS.map((s) => s.delay)).toEqual([0, 0.2, 0.4]);
    expect(TWINKLE_STARS[1].rotate).toBe(0);
    expect(TWINKLE_STARS[0].rotate).toBe(-12);
    expect(TWINKLE_STARS[2].rotate).toBe(14);
  });

  it('drifts exactly six dust stars, 10-16px, over 22-30s', () => {
    expect(DUST_STARS).toHaveLength(6);
    for (const star of DUST_STARS) {
      expect(star.size).toBeGreaterThanOrEqual(10);
      expect(star.size).toBeLessThanOrEqual(16);
      expect(star.duration).toBeGreaterThanOrEqual(22);
      expect(star.duration).toBeLessThanOrEqual(30);
    }
    // Staggered starts so the field never pulses in sync.
    expect(new Set(DUST_STARS.map((s) => s.delay)).size).toBe(DUST_STARS.length);
  });
});
