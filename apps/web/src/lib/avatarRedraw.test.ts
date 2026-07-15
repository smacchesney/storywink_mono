import { describe, it, expect } from 'vitest';
import { hasRedrawSource, redrawDialogState, type RedrawSourceRendition } from './avatarRedraw';

/** Rendition-source fixture — READY renditions carry a sheet unless told otherwise. */
const r = (
  artStyle: string,
  status: RedrawSourceRendition['status'],
  opts: { sheet?: string | null } = {},
): RedrawSourceRendition => ({
  artStyle,
  status,
  turnaroundSheetUrl:
    'sheet' in opts ? (opts.sheet ?? null) : status === 'READY' ? 'sheet.png' : null,
});

describe('hasRedrawSource', () => {
  it('is true when staged photos exist, regardless of renditions', () => {
    expect(hasRedrawSource(1, [], 'vignette')).toBe(true);
    expect(hasRedrawSource(3, [r('vignette', 'FAILED')], 'vignette')).toBe(true);
  });

  it('is true when a READY rendition of a DIFFERENT style has a sheet to derive from', () => {
    expect(hasRedrawSource(0, [r('kawaii', 'READY')], 'vignette')).toBe(true);
  });

  it('is false for a same-style redraw of the only READY rendition after photos were deleted', () => {
    // The brick hazard: no photos, and the only READY sheet is the style being
    // redrawn — the worker has no different-style source and would throw.
    expect(hasRedrawSource(0, [r('vignette', 'READY')], 'vignette')).toBe(false);
  });

  it('is false when the other-style rendition is not READY', () => {
    expect(hasRedrawSource(0, [r('kawaii', 'PENDING')], 'vignette')).toBe(false);
    expect(hasRedrawSource(0, [r('kawaii', 'FAILED')], 'vignette')).toBe(false);
  });

  it('is false when a different-style READY rendition has no sheet (mirrors the worker)', () => {
    expect(hasRedrawSource(0, [r('kawaii', 'READY', { sheet: null })], 'vignette')).toBe(false);
  });

  it('is false with no photos and no renditions at all', () => {
    expect(hasRedrawSource(0, [], 'vignette')).toBe(false);
  });

  it('proves the needsPhoto invariant: no source with zero photos means no other-style READY sheet', () => {
    // The dialog uses relearn:true for a needsPhoto redraw because this can only
    // occur with zero photos AND no READY rendition of another style — so there
    // is nothing to relearn identity from except a fresh photo.
    const renditions = [r('vignette', 'READY'), r('vignette', 'FAILED')];
    const requested = 'vignette';
    const noSource = !hasRedrawSource(0, renditions, requested);
    const noOtherStyleReady = !renditions.some(
      (x) => x.status === 'READY' && x.artStyle !== requested && x.turnaroundSheetUrl,
    );
    expect(noSource).toBe(true);
    expect(noOtherStyleReady).toBe(true);
  });
});

describe('redrawDialogState', () => {
  it('shows the plain confirm when nothing special applies (Track E default)', () => {
    expect(redrawDialogState({ targetIsFailed: false, needsPhoto: false })).toBe('confirm');
  });

  it('shows the failed-recovery dialog when the target rendition is FAILED', () => {
    expect(redrawDialogState({ targetIsFailed: true, needsPhoto: false })).toBe('failedRecovery');
  });

  it('lets needsPhoto win over everything (the brick case)', () => {
    expect(redrawDialogState({ targetIsFailed: false, needsPhoto: true })).toBe('needsPhoto');
    expect(redrawDialogState({ targetIsFailed: true, needsPhoto: true })).toBe('needsPhoto');
  });
});
