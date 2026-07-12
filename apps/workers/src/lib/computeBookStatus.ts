import { categorizePages } from '@storywink/shared/utils';

/**
 * Minimal page shape needed to decide a book's final status.
 * Mirrors the fields the book-finalize worker reads off each Prisma page row.
 */
export interface StatusPage {
  text: string | null;
  generatedImageUrl: string | null;
  assetId: string | null;
}

/**
 * Computes a book's final status from its pages, reproducing the exact
 * decision the book-finalize worker made inline.
 *
 * Semantics (extracted verbatim from book-finalize.worker.ts):
 *  - `categorizePages` returns `storyPages === pages` (every page), so
 *    `textComplete` requires EVERY page to carry non-empty trimmed text.
 *  - `illustrationsComplete` requires EVERY page to have a generatedImageUrl.
 *  - COMPLETED when both are complete.
 *  - COMPLETED when all illustrations are present even if some text is missing
 *    (the "all illustrations complete" short-circuit).
 *  - PARTIAL when at least one page has text OR at least one page has an
 *    illustration, but the COMPLETED conditions are not met.
 *  - FAILED when nothing has been generated at all.
 */
export function computeBookStatus(
  pages: StatusPage[],
  coverAssetId: string | null,
): 'COMPLETED' | 'PARTIAL' | 'FAILED' {
  const { storyPages } = categorizePages(pages, coverAssetId);

  const pagesWithText = pages.filter((p) => p.text && p.text.trim().length > 0);
  const storyPagesWithText = storyPages.filter((p) => p.text && p.text.trim().length > 0);
  const pagesWithIllustrations = pages.filter((p) => p.generatedImageUrl);

  const totalPages = pages.length;
  const textComplete = storyPagesWithText.length === storyPages.length;
  const illustrationsComplete = pagesWithIllustrations.length === totalPages;

  if (textComplete && illustrationsComplete) {
    return 'COMPLETED';
  } else if (illustrationsComplete) {
    return 'COMPLETED';
  } else if (pagesWithText.length > 0 || pagesWithIllustrations.length > 0) {
    return 'PARTIAL';
  } else {
    return 'FAILED';
  }
}
