/**
 * Reader gesture math — the pure half of the preview page's tap/swipe
 * handling, kept dependency-free so it can be unit-tested in plain node.
 *
 * The gesture contract (spec §C): vertical swipe = nothing; horizontal
 * swipe, edge tap, chevrons, arrows = flip. page-flip keeps drag-to-fold and
 * quick horizontal swipes; we own tap semantics and suppress the engine's
 * corner-release flip after a vertical scroll attempt.
 */

/** Pointer travel below this is a tap, not a drag. */
export const TAP_TRAVEL_PX = 10;

/**
 * Edge-tap zones: left 35% turns back, right 35% turns forward, the middle
 * third does nothing (it belongs to reading, not navigation).
 */
export function edgeTapZone(xFraction: number): 'prev' | 'next' | null {
  if (xFraction < 0.35) return 'prev';
  if (xFraction > 0.65) return 'next';
  return null;
}

/**
 * A finger that moved mostly down/up (dy > 30 with dx < 10) was a scroll
 * attempt. page-flip's `|dx| > 10` gate keeps it from folding, but its
 * touchend would still flip a release near a page corner (the
 * disableFlipByClick corner exception) — the exact "I tried to scroll and it
 * turned the page" bug. When this returns true the reader calls
 * `pageFlip().userStop(pos, true)` first, which clears the engine's touch
 * state without flipping.
 */
export function isVerticalScrollGesture(dx: number, dy: number): boolean {
  return Math.abs(dy) > 30 && Math.abs(dx) < 10;
}

/**
 * Replicates page-flip's isPointOnCorners (Flip.ts): squares of side
 * sqrt(pageW² + blockH²) / 5 at the four corners of the book block. With
 * `disableFlipByClick` the engine still flips clicks inside these squares,
 * so the reader's own edge-tap handler must stay out of them or every corner
 * tap turns two pages.
 */
export function isOnEngineCorner(
  x: number,
  y: number,
  blockWidth: number,
  blockHeight: number,
  pageWidth: number,
): boolean {
  const operatingDistance = Math.hypot(pageWidth, blockHeight) / 5;
  return (
    x > 0 &&
    y > 0 &&
    x < blockWidth &&
    y < blockHeight &&
    (x < operatingDistance || x > blockWidth - operatingDistance) &&
    (y < operatingDistance || y > blockHeight - operatingDistance)
  );
}

/**
 * Gallery default per viewport: collapsed on phone portrait (< 768px wide)
 * and in extreme landscape (short + very wide), visible everywhere else.
 * Only used until the reader's first manual toggle — an explicit choice wins.
 */
export function galleryDefaultVisible(width: number, height: number): boolean {
  const portrait = height >= width;
  const phonePortrait = portrait && width < 768;
  const extremeLandscape = !portrait && height < 500 && width / height > 2;
  return !(phonePortrait || extremeLandscape);
}

/** Phone portrait is the layout where the gallery opens as an overlay. */
export function isPhonePortraitViewport(width: number, height: number): boolean {
  return height >= width && width < 768;
}
