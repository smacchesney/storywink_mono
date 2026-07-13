/**
 * Instance patches for page-flip v2.0.7 (unmaintained upstream).
 *
 * Bug A — backward flips silently no-op in portrait. Flip.flipPrev() fabricates
 * its corner point at a HARDCODED DOM-space x of 10, then Flip.flip() opens with
 * `if (disableFlipByClick && !isPointOnCorners(point)) return`. isPointOnCorners
 * runs the point through convertToBook, subtracting getRect().left, into a
 * two-page-wide book space; the corner bands are x < s || x > width - s. In
 * SPREAD mode left === 0, so book-x = 10 falls in the left band and the flip
 * fires. In PORTRAIT the rect is shifted (left === -pageWidth), so book-x
 * becomes 10 + pageWidth ≈ mid-book, the guard rejects it, and every backward
 * flip dies — reader chevron, ArrowLeft, edge-tap, and the engine's own touch
 * swipe-back (which calls the public flipPrev, delegating here) all no-op.
 *
 * Fix: rebuild flipController.flipPrev's point from the LIVE getBoundsRect().left
 * (rect.left + 10) so convertToBook always yields book-x = 10 — the left corner
 * band — in every orientation. getDirectionByPoint then reads BACK correctly in
 * both modes. Patching flipController.flipPrev catches every caller, because the
 * public PageFlip.flipPrev delegates straight to it.
 */
export interface PageFlipLike {
  getBoundsRect(): { left: number; height: number };
  flipController?: {
    flip(pos: { x: number; y: number }): void;
    flipPrev(corner: 'top' | 'bottom'): void;
  };
}

/**
 * Returns true when the instance was patched, false when the internals we rely
 * on are missing (native behavior is left untouched). Idempotent: re-patching
 * re-wraps our own wrapper, which still reads the live rect and never calls the
 * original flipPrev.
 */
export function patchFlipPrevPoint(pf: PageFlipLike | null | undefined): boolean {
  if (!pf || typeof pf.getBoundsRect !== 'function') return false;
  const controller = pf.flipController;
  if (!controller || typeof controller.flip !== 'function') return false;

  controller.flipPrev = (corner: 'top' | 'bottom' = 'top') => {
    const rect = pf.getBoundsRect();
    controller.flip({ x: rect.left + 10, y: corner === 'top' ? 1 : rect.height - 2 });
  };
  return true;
}
