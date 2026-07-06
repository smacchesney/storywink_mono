/**
 * Pure display-page layout logic for the flipbook reader.
 *
 * Two layouts exist:
 * - `spread` (landscape / desktop): mirrors the Lulu print layout — cover,
 *   blank inside cover, dedication, then text-verso + illustration-recto
 *   pairs, ending, blank pad, back cover.
 * - `portrait` (phones held upright): one combined page per story beat —
 *   square illustration with its text right below it. No blank filler, so a
 *   10-photo book reads in 13 flips instead of 25 and the words stay with
 *   their picture.
 *
 * Kept free of React/Next imports so the layout and the rotation remap stay
 * unit-testable.
 */

export type BookLayout = 'spread' | 'portrait';

/** The slice of a Page the display layout needs. Prisma's Page satisfies it. */
export interface DisplaySourcePage {
  id: string;
  pageNumber: number;
  text: string | null;
  isTitlePage: boolean;
  generatedImageUrl: string | null;
}

// Display page types for the interleaved layouts
export type DisplayPage<P extends DisplaySourcePage = DisplaySourcePage> =
  | { type: 'illustration'; page: P }
  | { type: 'text'; page: P; language: string }
  /** Portrait-only: square illustration + text strip on one page */
  | { type: 'story'; page: P; language: string }
  | { type: 'dedication'; childName: string | null; bookTitle: string; language: string }
  | { type: 'ending'; childName: string | null; bookTitle: string; language: string }
  | { type: 'back-cover' }
  | { type: 'blank' };

export interface BuildDisplayPagesOptions {
  childName?: string | null;
  bookTitle?: string;
  language?: string;
  /** Defaults to 'spread' — the print-faithful layout existing callers get. */
  layout?: BookLayout;
}

/**
 * Build interleaved display pages.
 *
 * Spread layout (print-faithful, unchanged):
 *   [0] Cover illustration (solo right)
 *   [1] Blank inside front cover (left) — saddle stitch: inside covers not printable
 *   [2] Dedication (right)
 *   [3] Text story 1 (left)  +  [4] Illustration story 1 (right)
 *   ...
 *   [N] Ending (left)  +  [N+1] Blank padding (right)
 *   [N+2] Back cover (solo left)
 *
 * Portrait layout (combined pages, no filler):
 *   [0] Cover
 *   [1] Dedication
 *   [2..] One combined story page per non-title page (art + text together)
 *   [..] Ending
 *   [..] Back cover
 */
export function buildDisplayPages<P extends DisplaySourcePage>(
  pages: P[],
  options?: BuildDisplayPagesOptions
): DisplayPage<P>[] {
  const displayPages: DisplayPage<P>[] = [];
  const language = options?.language || 'en';
  const layout = options?.layout ?? 'spread';
  // Find the cover page and render it first
  const coverPage = pages.find((p) => p.isTitlePage);

  if (layout === 'portrait') {
    if (coverPage) {
      displayPages.push({ type: 'illustration', page: coverPage });
      displayPages.push({
        type: 'dedication',
        childName: options?.childName ?? null,
        bookTitle: options?.bookTitle ?? 'You',
        language,
      });
    }
    // One combined page per story beat. The title page already fronts the
    // book as the cover, so it does not repeat as a beat here.
    for (const page of pages) {
      if (page.isTitlePage) continue;
      displayPages.push({ type: 'story', page, language });
    }
    displayPages.push({
      type: 'ending',
      childName: options?.childName ?? null,
      bookTitle: options?.bookTitle ?? 'You',
      language,
    });
    displayPages.push({ type: 'back-cover' });
    return displayPages;
  }

  if (coverPage) {
    // Cover page (solo right with showCover)
    displayPages.push({ type: 'illustration', page: coverPage });
    // Blank inside front cover (left side of first spread)
    displayPages.push({ type: 'blank' });
    // Dedication (right side of first spread)
    displayPages.push({
      type: 'dedication',
      childName: options?.childName ?? null,
      bookTitle: options?.bookTitle ?? 'You',
      language,
    });
  }
  // All pages get text+illustration pairs in story order
  // Only include text page if the page actually has story text
  for (const page of pages) {
    if (page.text && page.text.trim()) {
      displayPages.push({ type: 'text', page, language });
    }
    displayPages.push({ type: 'illustration', page });
  }
  // Ending page (left side of last story spread)
  displayPages.push({
    type: 'ending',
    childName: options?.childName ?? null,
    bookTitle: options?.bookTitle ?? 'You',
    language,
  });
  // Blank padding (right side, keeps middle page count even)
  displayPages.push({ type: 'blank' });
  // Back cover (solo left with showCover)
  displayPages.push({ type: 'back-cover' });
  return displayPages;
}

/**
 * Canonical identity of a display entry, used to find "the same place" in
 * the other layout. Blanks have none (they only exist as print filler).
 * Index 0 with a title page is the cover slot — distinct from the same
 * page's mid-book story beat in the spread layout.
 */
function displayKey<P extends DisplaySourcePage>(dp: DisplayPage<P>, index: number): string | null {
  switch (dp.type) {
    case 'dedication':
      return 'dedication';
    case 'ending':
      return 'ending';
    case 'back-cover':
      return 'back-cover';
    case 'blank':
      return null;
    case 'story':
    case 'text':
      return `page:${dp.page.id}`;
    case 'illustration':
      return index === 0 && dp.page.isTitlePage ? 'cover' : `page:${dp.page.id}`;
  }
}

/**
 * Remap a 0-based display index from one layout's page list to another's,
 * by source-page identity. When the current entry has no counterpart (a
 * blank, or the title page's spread-only story beat), the nearest mappable
 * neighbour wins — forward first, since that is the page the reader was
 * about to see. Falls back to a clamped same-index.
 */
export function remapDisplayIndex<P extends DisplaySourcePage>(
  from: DisplayPage<P>[],
  fromIndex: number,
  to: DisplayPage<P>[]
): number {
  if (to.length === 0) return 0;
  if (from.length === 0) return Math.max(0, Math.min(fromIndex, to.length - 1));
  let start = Math.max(0, Math.min(fromIndex, from.length - 1));

  // In the spread layout (showCover: index 0 solo, then odd-left/even-right
  // pairs) the flip engine reports the LEFT page of the visible pair. When
  // that pair is a previous beat's illustration beside the NEXT beat's text
  // (the title page's solo beat shifts pairing this way), the reader is on
  // the text — anchor there instead.
  const fromHasStories = from.some((dp) => dp.type === 'story');
  if (!fromHasStories && start % 2 === 1 && start + 1 < from.length) {
    const left = from[start];
    const right = from[start + 1];
    if (
      left.type === 'illustration' &&
      right.type === 'text' &&
      left.page.id !== right.page.id
    ) {
      start = start + 1;
    }
  }

  // Candidate entries: current first, then rippling outward, forward-biased.
  const candidates: number[] = [start];
  for (let d = 1; d < from.length; d++) {
    if (start + d < from.length) candidates.push(start + d);
    if (start - d >= 0) candidates.push(start - d);
  }

  for (const i of candidates) {
    const key = displayKey(from[i], i);
    if (!key) continue;
    const target = to.findIndex((dp, j) => displayKey(dp, j) === key);
    if (target !== -1) return target;
  }

  return Math.min(start, to.length - 1);
}
