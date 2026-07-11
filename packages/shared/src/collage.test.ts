import { describe, it, expect } from 'vitest';
import {
  collageSlots,
  planCollage,
  collagePagesForPrint,
  MAX_COLLAGE_PHOTOS_PER_PAGE,
  CollageSlot,
} from './collage.js';

describe('collageSlots', () => {
  it('returns exactly count slots for every supported count', () => {
    for (let n = 1; n <= MAX_COLLAGE_PHOTOS_PER_PAGE; n++) {
      expect(collageSlots(n)).toHaveLength(n);
    }
  });

  it('is deterministic (same table object each call)', () => {
    expect(collageSlots(4)).toEqual(collageSlots(4));
  });

  it('keeps every polaroid inside the 0.5in safety margin of the 8.5in trim', () => {
    // Outer polaroid extent: window + 0.15in side frames, 0.55in chin below.
    // Bleed page is 8.75in; trim starts at 0.125in; safety = trim + 0.5in.
    const SAFE_MIN = 0.625;
    const SAFE_MAX = 8.75 - 0.625;
    for (let n = 1; n <= MAX_COLLAGE_PHOTOS_PER_PAGE; n++) {
      for (const slot of collageSlots(n)) {
        const halfW = slot.windowIn / 2 + 0.15;
        const top = slot.yIn - slot.windowIn / 2 - 0.15;
        const bottom = slot.yIn + slot.windowIn / 2 + 0.55;
        // Rotation widens the bounding box slightly; 6° on ≤4.3in ≈ ≤0.25in.
        const wobble = 0.25;
        expect(slot.xIn - halfW - wobble).toBeGreaterThanOrEqual(SAFE_MIN - 0.01);
        expect(slot.xIn + halfW + wobble).toBeLessThanOrEqual(SAFE_MAX + 0.01);
        expect(top - wobble).toBeGreaterThanOrEqual(SAFE_MIN - 0.01);
        expect(bottom + wobble).toBeLessThanOrEqual(SAFE_MAX + 0.01);
      }
    }
  });

  it('alternates rotation direction within each table', () => {
    for (let n = 2; n <= MAX_COLLAGE_PHOTOS_PER_PAGE; n++) {
      const slots = collageSlots(n);
      const hasNegative = slots.some((s: CollageSlot) => s.rotationDeg < 0);
      const hasPositive = slots.some((s: CollageSlot) => s.rotationDeg > 0);
      expect(hasNegative && hasPositive).toBe(true);
    }
  });

  it('throws on unsupported counts', () => {
    expect(() => collageSlots(0)).toThrow();
    expect(() => collageSlots(7)).toThrow();
  });
});

describe('planCollage', () => {
  it('0 photos → no collage', () => {
    expect(planCollage(0)).toEqual({ perPage: [], dropped: 0 });
  });

  it('1-6 photos → one page', () => {
    expect(planCollage(1)).toEqual({ perPage: [1], dropped: 0 });
    expect(planCollage(6)).toEqual({ perPage: [6], dropped: 0 });
  });

  it('7-12 photos → two balanced pages, larger first', () => {
    expect(planCollage(7)).toEqual({ perPage: [4, 3], dropped: 0 });
    expect(planCollage(11)).toEqual({ perPage: [6, 5], dropped: 0 });
    expect(planCollage(12)).toEqual({ perPage: [6, 6], dropped: 0 });
  });

  it('beyond 12 → curated 12, extras counted as dropped', () => {
    expect(planCollage(23)).toEqual({ perPage: [6, 6], dropped: 11 });
  });
});

describe('collagePagesForPrint (Lulu 48-page cap)', () => {
  it('even photo counts absorb the collage into existing pad slots', () => {
    // N=10: raw 22 → padded 24 with or without 2 collage pages.
    expect(collagePagesForPrint(10)).toBe(2);
  });

  it('N=22 fits exactly at 48', () => {
    // raw 46 + 2 collage = 48.
    expect(collagePagesForPrint(22)).toBe(2);
  });

  it('N=23 skips the collage entirely (would exceed 48)', () => {
    expect(collagePagesForPrint(23)).toBe(0);
  });

  it('small books get one page', () => {
    expect(collagePagesForPrint(3)).toBe(1);
  });
});
