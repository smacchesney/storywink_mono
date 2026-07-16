/**
 * Pure view math for the example-book overlay.
 *
 * FlipbookViewer renders `buildDisplayPages(...)` pages in one of two
 * layouts. Progress must track VIEWS (what the reader sees per flip), not
 * raw display pages, or the dots and the end detection drift:
 *
 * - portrait: one display page per view → views = displayCount
 * - spread:   cover alone, then pairs   → views = 1 + ceil((displayCount-1)/2)
 *
 * Both collapse to the same view count for the same book, so rotating the
 * phone mid-read keeps the dots honest.
 */
// Relative import (not `@/`) so the root vitest config can resolve it.
import type { BookLayout } from '../book/display-pages';

export interface ViewState {
  totalViews: number;
  currentView: number;
  isAtEnd: boolean;
}

/**
 * @param displayIndex zero-based display-page index (FlipbookViewer's
 * onPageChange reports displayIndex + 1).
 */
export function computeViewState(
  layout: BookLayout,
  displayCount: number,
  displayIndex: number,
): ViewState {
  if (displayCount <= 0) {
    return { totalViews: 0, currentView: 0, isAtEnd: false };
  }
  const totalViews = layout === 'portrait' ? displayCount : 1 + Math.ceil((displayCount - 1) / 2);
  const clampedIndex = Math.max(0, Math.min(displayIndex, displayCount - 1));
  const currentView =
    layout === 'portrait' ? clampedIndex : clampedIndex === 0 ? 0 : Math.ceil(clampedIndex / 2);
  return { totalViews, currentView, isAtEnd: currentView >= totalViews - 1 };
}

/**
 * Progress dots, capped so long books don't render a noise strip. The first
 * view lights only the first dot; the last view always lights the last.
 */
export function computeDots(
  totalViews: number,
  currentView: number,
  cap = 12,
): { dotCount: number; activeDot: number } {
  const dotCount = Math.min(Math.max(totalViews, 0), cap);
  const activeDot =
    totalViews <= 1 ? 0 : Math.round((currentView * (dotCount - 1)) / (totalViews - 1));
  return { dotCount, activeDot };
}
