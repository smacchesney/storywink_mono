import { describe, it, expect } from 'vitest';
import {
  swatchState,
  sheetRowState,
  displayableStyles,
  showSwatchRow,
  defaultDisplayedStyle,
  drawAgainStyle,
  redrawTargetIsFailed,
  type WardrobeRendition,
} from './avatarWardrobe';

/** Rendition fixture — READY renditions get an image unless told otherwise. */
const r = (
  artStyle: string,
  status: WardrobeRendition['status'],
  opts: { cutout?: string | null; portrait?: string | null } = {},
): WardrobeRendition => ({
  artStyle,
  status,
  cutoutUrl: 'cutout' in opts ? (opts.cutout ?? null) : status === 'READY' ? 'c.png' : null,
  portraitUrl: 'portrait' in opts ? (opts.portrait ?? null) : null,
});

describe('swatchState', () => {
  it('is undrawn when the style has no rendition', () => {
    expect(swatchState(undefined)).toBe('undrawn');
  });

  it('reflects the rendition status', () => {
    expect(swatchState({ status: 'READY' })).toBe('drawn');
    expect(swatchState({ status: 'PENDING' })).toBe('drawing');
    expect(swatchState({ status: 'FAILED' })).toBe('failed');
  });
});

describe('sheetRowState', () => {
  // The core reconciliation: a real TERMINAL rendition always wins over the
  // optimistic just-drew flag. This is the bug the finding pins — before, a
  // set justDrew masked the polled READY forever and the row stayed "drawing".
  it('shows the polled READY (drawn) even while justDrew is still set', () => {
    expect(sheetRowState({ status: 'READY' }, true)).toBe('drawn');
  });

  it('shows the polled FAILED even while justDrew is still set', () => {
    expect(sheetRowState({ status: 'FAILED' }, true)).toBe('failed');
  });

  it('bridges an undrawn/absent style to drawing while justDrew is set', () => {
    expect(sheetRowState(undefined, true)).toBe('drawing');
  });

  it('reverts to undrawn when justDrew clears and no rendition arrived (429 path)', () => {
    expect(sheetRowState(undefined, false)).toBe('undrawn');
  });

  it('is drawing for a PENDING rendition regardless of the flag', () => {
    expect(sheetRowState({ status: 'PENDING' }, true)).toBe('drawing');
    expect(sheetRowState({ status: 'PENDING' }, false)).toBe('drawing');
  });

  it('matches swatchState once the flag is clear (no optimism)', () => {
    expect(sheetRowState({ status: 'READY' }, false)).toBe('drawn');
    expect(sheetRowState({ status: 'FAILED' }, false)).toBe('failed');
  });
});

describe('displayableStyles', () => {
  it('returns displayable styles in STYLE_LIBRARY key order, not array order', () => {
    // Input lists kawaii before vignette — output must be key order.
    expect(displayableStyles([r('kawaii', 'READY'), r('vignette', 'READY')])).toEqual([
      'vignette',
      'kawaii',
    ]);
  });

  it('excludes renditions that are not READY', () => {
    expect(displayableStyles([r('vignette', 'READY'), r('kawaii', 'PENDING')])).toEqual([
      'vignette',
    ]);
  });

  it('excludes a READY rendition with no image to show', () => {
    expect(
      displayableStyles([r('vignette', 'READY', { cutout: null }), r('kawaii', 'READY')]),
    ).toEqual(['kawaii']);
  });

  it('counts a READY rendition shown only by its portrait crop', () => {
    expect(displayableStyles([r('origami', 'READY', { cutout: null, portrait: 'p.png' })])).toEqual(
      ['origami'],
    );
  });
});

describe('showSwatchRow', () => {
  it('is false for a single displayable outfit (zero added chrome)', () => {
    expect(showSwatchRow([r('vignette', 'READY')])).toBe(false);
  });

  it('is true only with two or more displayable outfits', () => {
    expect(showSwatchRow([r('vignette', 'READY'), r('kawaii', 'READY')])).toBe(true);
  });

  it('does not count a drawing or failed style toward the row', () => {
    expect(
      showSwatchRow([r('vignette', 'READY'), r('kawaii', 'PENDING'), r('origami', 'FAILED')]),
    ).toBe(false);
  });
});

describe('defaultDisplayedStyle', () => {
  it('is the first displayable style in key order', () => {
    expect(defaultDisplayedStyle([r('kawaii', 'READY'), r('vignette', 'READY')])).toBe('vignette');
  });

  it('is null when nothing is displayable', () => {
    expect(defaultDisplayedStyle([r('vignette', 'PENDING')])).toBeNull();
    expect(defaultDisplayedStyle([])).toBeNull();
  });
});

describe('drawAgainStyle', () => {
  it('targets the displayed style when one is shown', () => {
    expect(drawAgainStyle([r('vignette', 'READY'), r('kawaii', 'READY')], 'kawaii')).toBe('kawaii');
  });

  it('falls back to the first FAILED rendition when nothing is READY', () => {
    expect(drawAgainStyle([r('origami', 'FAILED'), r('vignette', 'FAILED')], null)).toBe('origami');
  });

  it('falls back to the first rendition when nothing is READY or FAILED', () => {
    expect(drawAgainStyle([r('kawaii', 'PENDING')], null)).toBe('kawaii');
  });

  it("falls back to 'vignette' when there are no renditions at all", () => {
    expect(drawAgainStyle([], null)).toBe('vignette');
  });
});

describe('redrawTargetIsFailed', () => {
  // Drives the confirm dialog's conditional retry note: it shows ONLY when the
  // rendition "draw again" will redraw is a FAILED one.
  it('is true when nothing is READY and the fallback lands on a FAILED style', () => {
    expect(redrawTargetIsFailed([r('origami', 'FAILED')], null)).toBe(true);
  });

  it('is false when the displayed (READY) style is what gets redrawn', () => {
    expect(redrawTargetIsFailed([r('vignette', 'READY'), r('kawaii', 'READY')], 'kawaii')).toBe(
      false,
    );
  });

  it('is false when redrawing the shown READY style while another style is FAILED', () => {
    expect(redrawTargetIsFailed([r('vignette', 'READY'), r('kawaii', 'FAILED')], 'vignette')).toBe(
      false,
    );
  });

  it('is false when the fallback target is a PENDING rendition', () => {
    expect(redrawTargetIsFailed([r('kawaii', 'PENDING')], null)).toBe(false);
  });

  it("is false when there are no renditions (fallback 'vignette' has no row)", () => {
    expect(redrawTargetIsFailed([], null)).toBe(false);
  });
});
