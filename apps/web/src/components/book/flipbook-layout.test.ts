import { describe, it, expect } from 'vitest';
import { calculateBookBox } from './flipbook-layout';

/**
 * The ORIGINAL calculateBookDimensions math (fixed 0.78 portrait aspect),
 * reproduced here so spread outputs can be pinned byte-for-byte and the 0.78
 * cap can be proven to preserve old behavior.
 */
function legacyBox(width: number, height: number) {
  const padding = 32;
  const availableWidth = width - padding;
  const availableHeight = height - padding;
  const aspectRatio = width / height;
  const isExtremeAspectRatio = aspectRatio > 2.5;
  const hasMinimumHeight = height >= 350;
  const shouldShowSpread = width >= 640 && hasMinimumHeight && !isExtremeAspectRatio;

  if (!shouldShowSpread) {
    const pageWidth = availableWidth;
    const pageHeight = availableHeight;
    const pageAspectRatio = 0.78;
    let finalWidth = pageWidth;
    let finalHeight = pageHeight;
    if (pageWidth / pageHeight > pageAspectRatio) finalWidth = pageHeight * pageAspectRatio;
    else finalHeight = pageWidth / pageAspectRatio;
    return { width: Math.floor(finalWidth), height: Math.floor(finalHeight), isPortrait: true };
  }

  const spreadAspectRatio = 2.0;
  let spreadWidth = availableWidth;
  let spreadHeight = availableHeight;
  if (spreadWidth / spreadHeight > spreadAspectRatio) spreadWidth = spreadHeight * spreadAspectRatio;
  else spreadHeight = spreadWidth / spreadAspectRatio;
  return { width: Math.floor(spreadWidth / 2), height: Math.floor(spreadHeight), isPortrait: false };
}

describe('calculateBookBox — spread (unchanged, print-faithful)', () => {
  it('pins the current width-limited spread output byte-for-byte', () => {
    expect(calculateBookBox({ width: 1200, height: 614 })).toEqual({
      width: 582,
      height: 582,
      isPortrait: false,
    });
    expect(calculateBookBox({ width: 1200, height: 614 })).toEqual(legacyBox(1200, 614));
  });

  it('pins the current height-limited spread output byte-for-byte', () => {
    expect(calculateBookBox({ width: 1000, height: 700 })).toEqual({
      width: 484,
      height: 484,
      isPortrait: false,
    });
    expect(calculateBookBox({ width: 1000, height: 700 })).toEqual(legacyBox(1000, 700));
  });

  it('matches legacy across a sweep of spread containers', () => {
    for (const [w, h] of [
      [1280, 800],
      [768, 500],
      [900, 600],
      [1440, 900],
    ] as const) {
      expect(calculateBookBox({ width: w, height: h })).toEqual(legacyBox(w, h));
    }
  });
});

describe('calculateBookBox — shouldShowSpread boundary', () => {
  it('spreads at the exact 640×350 threshold', () => {
    expect(calculateBookBox({ width: 640, height: 350 }).isPortrait).toBe(false);
  });

  it('goes portrait just under the width or height threshold', () => {
    expect(calculateBookBox({ width: 639, height: 350 }).isPortrait).toBe(true);
    expect(calculateBookBox({ width: 640, height: 349 }).isPortrait).toBe(true);
  });

  it('goes portrait on an extreme aspect ratio even when wide', () => {
    expect(calculateBookBox({ width: 900, height: 350 }).isPortrait).toBe(true); // aspect 2.57
    expect(calculateBookBox({ width: 870, height: 350 }).isPortrait).toBe(false); // aspect 2.48
  });
});

describe('calculateBookBox — portrait aspect clamp [0.62, 0.78]', () => {
  it('caps squat portrait boxes at 0.78 — identical to old behavior', () => {
    // width < 640 → portrait; available ratio 1.54 clamps to the 0.78 cap.
    expect(calculateBookBox({ width: 600, height: 400 })).toEqual({
      width: 287,
      height: 368,
      isPortrait: true,
    });
    expect(calculateBookBox({ width: 600, height: 400 })).toEqual(legacyBox(600, 400));
  });

  it('floors slender phone boxes at 0.62 — taller than the old 0.78 forced', () => {
    // 375×812: available 343×780, ratio 0.44 → clamped up to 0.62.
    const box = calculateBookBox({ width: 375, height: 812 });
    expect(box).toEqual({ width: 343, height: Math.floor(343 / 0.62), isPortrait: true });
    expect(box.height).toBe(553);
    // The whole point of the fix: the page is TALLER than the old cap allowed,
    // reclaiming the dead space below the 0.78 card.
    expect(box.height).toBeGreaterThan(legacyBox(375, 812).height);
  });

  it('lets a mid-ratio box fill the available space exactly (aspect === ratio)', () => {
    // 400×600: available 368×568, ratio 0.648 sits inside the band.
    const container = { width: 400, height: 600 };
    const box = calculateBookBox(container);
    expect(box.isPortrait).toBe(true);
    expect(box.width).toBe(368); // full available width
    expect(Math.abs(box.height - 568)).toBeLessThanOrEqual(1); // fills available height
    // A mid-ratio box is neither the 0.62 floor nor the 0.78 cap.
    expect(box.height).not.toBe(Math.floor(368 / 0.62));
    expect(box.height).not.toBe(legacyBox(400, 600).height); // 0.78 would be shorter
  });
});
