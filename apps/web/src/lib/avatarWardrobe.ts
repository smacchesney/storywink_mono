/**
 * Pure client-state helpers for the read-only character wardrobe (X11 C).
 *
 * The data already models "one identity, one outfit per art style"
 * (`AvatarRendition @@unique([avatarId, artStyle])`). These helpers turn that
 * row set into the shelf's swatch row, the "…'s styles" sheet's per-style
 * state, and the deterministic default display — no fetch, no React, so the
 * behaviour is pinned by colocated unit tests.
 */

import { getAllStyleKeys, type StyleKey } from '@storywink/shared/prompts/styles';

export interface WardrobeRendition {
  artStyle: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  cutoutUrl: string | null;
  portraitUrl: string | null;
}

export type SwatchState = 'drawn' | 'drawing' | 'failed' | 'undrawn';

/**
 * The per-style row state for the "…'s styles" sheet, derived from that
 * style's rendition (or its absence). READY is drawn, PENDING is drawing,
 * FAILED surfaces as a retry row, and a missing rendition is undrawn.
 */
export function swatchState(
  rendition: { status: WardrobeRendition['status'] } | undefined,
): SwatchState {
  if (!rendition) return 'undrawn';
  if (rendition.status === 'READY') return 'drawn';
  if (rendition.status === 'PENDING') return 'drawing';
  return 'failed';
}

/**
 * The "…'s styles" sheet row state, reconciling the optimistic just-drew flag
 * with the polled rendition. A real TERMINAL rendition always wins: once the
 * 4s poll delivers READY (drawn) or FAILED, that shows even if the row was
 * tapped — otherwise a stale justDrew would mask it and the row would read
 * "drawing…" forever. justDrew only bridges the undrawn/absent 0-4s gap before
 * the PENDING rendition appears, so the tapped row reads "drawing…" instantly
 * without ever hiding the real result.
 */
export function sheetRowState(
  rendition: { status: WardrobeRendition['status'] } | undefined,
  justDrew: boolean,
): SwatchState {
  const base = swatchState(rendition);
  if (base === 'drawn' || base === 'failed') return base;
  return justDrew ? 'drawing' : base;
}

/** A rendition the card can actually show: READY with a cutout or portrait. */
function isDisplayable(r: WardrobeRendition): boolean {
  return r.status === 'READY' && Boolean(r.cutoutUrl || r.portraitUrl);
}

/**
 * The styles a card can display, in STYLE_LIBRARY key order — the swatch row's
 * contents. Ordering is deterministic (key order), never the API's array order.
 */
export function displayableStyles(renditions: WardrobeRendition[]): StyleKey[] {
  const present = new Set(renditions.filter(isDisplayable).map((r) => r.artStyle));
  return getAllStyleKeys().filter((key) => present.has(key));
}

/**
 * Show the swatch row ONLY with two or more displayable outfits. A single
 * READY outfit — the 90% case — gets no row and zero added chrome.
 */
export function showSwatchRow(renditions: WardrobeRendition[]): boolean {
  return displayableStyles(renditions).length >= 2;
}

/** Deterministic default display: the first displayable style in key order (else null). */
export function defaultDisplayedStyle(renditions: WardrobeRendition[]): StyleKey | null {
  return displayableStyles(renditions)[0] ?? null;
}

/**
 * The style "draw again" redraws. It targets the DISPLAYED style when one is
 * shown; otherwise (nothing READY) it walks a fallback chain that can never
 * land on undefined: the first FAILED rendition's style → the first rendition's
 * style → 'vignette'.
 */
export function drawAgainStyle(
  renditions: Array<{ artStyle: string; status: WardrobeRendition['status'] }>,
  displayedStyle: StyleKey | null,
): string {
  if (displayedStyle) return displayedStyle;
  const failed = renditions.find((r) => r.status === 'FAILED');
  if (failed) return failed.artStyle;
  if (renditions[0]) return renditions[0].artStyle;
  return 'vignette';
}

/**
 * Whether "draw again" would redraw a FAILED rendition — the confirm dialog
 * shows its retry note only then. Resolves the same target `drawAgainStyle`
 * picks, then asks if that style's rendition is FAILED. Redrawing a displayed
 * (READY) outfit is never a retry, so no warning fires there.
 */
export function redrawTargetIsFailed(
  renditions: Array<{ artStyle: string; status: WardrobeRendition['status'] }>,
  displayedStyle: StyleKey | null,
): boolean {
  const target = drawAgainStyle(renditions, displayedStyle);
  return renditions.some((r) => r.artStyle === target && r.status === 'FAILED');
}
