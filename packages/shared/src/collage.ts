/**
 * The real-moments collage: pure slot geometry + page planning.
 *
 * Browser-safe (no node imports) — consumed by the PDF package for print
 * and by the flipbook viewer for the on-screen scatter, so both render the
 * SAME deterministic layout. All geometry is expressed in inches on the
 * 8.75" full-bleed page; screen consumers scale to their container.
 *
 * Deterministic on purpose: reprints of the same book must be identical,
 * so rotations and positions come from fixed per-count tables, never
 * randomness.
 */

import { calculatePrintedPageCount } from './utils.js';

/** One polaroid on a collage page. Center-based, inches on the 8.75" page. */
export interface CollageSlot {
  /** Center x in inches from the page's left edge. */
  xIn: number;
  /** Center y in inches from the page's top edge. */
  yIn: number;
  /** Square photo-window edge length in inches (frame/chin drawn around it). */
  windowIn: number;
  /** Rotation in degrees (alternating small tilts — scrapbook, not scanner). */
  rotationDeg: number;
}

/** Max photos per collage page (design cap: 7+ reads as a contact sheet). */
export const MAX_COLLAGE_PHOTOS_PER_PAGE = 6;
/** Max photos across the whole collage unit (two pages of six). */
export const MAX_COLLAGE_PHOTOS = 12;

/**
 * Fixed slot tables per photos-on-page count. Page 1 keeps the top ~1.6in
 * clear for the heading; page 2 reuses the same table (headingless pages
 * simply breathe more). Positions keep every polaroid inside the 0.5in
 * safety margin of the 8.5in trim.
 */
const SLOT_TABLES: Record<number, CollageSlot[]> = {
  1: [{ xIn: 4.375, yIn: 4.5, windowIn: 4.0, rotationDeg: -2 }],
  2: [
    { xIn: 3.0, yIn: 3.55, windowIn: 3.1, rotationDeg: -4 },
    { xIn: 5.75, yIn: 5.45, windowIn: 3.1, rotationDeg: 3 },
  ],
  3: [
    { xIn: 2.75, yIn: 3.2, windowIn: 2.8, rotationDeg: -5 },
    { xIn: 5.95, yIn: 3.45, windowIn: 2.6, rotationDeg: 4 },
    { xIn: 4.4, yIn: 5.85, windowIn: 2.9, rotationDeg: -2 },
  ],
  4: [
    { xIn: 2.7, yIn: 3.1, windowIn: 2.6, rotationDeg: -4 },
    { xIn: 6.05, yIn: 2.95, windowIn: 2.5, rotationDeg: 3 },
    { xIn: 2.85, yIn: 6.05, windowIn: 2.5, rotationDeg: 2 },
    { xIn: 5.95, yIn: 5.95, windowIn: 2.7, rotationDeg: -3 },
  ],
  5: [
    { xIn: 2.5, yIn: 2.95, windowIn: 2.4, rotationDeg: -5 },
    { xIn: 6.15, yIn: 2.85, windowIn: 2.3, rotationDeg: 4 },
    { xIn: 4.35, yIn: 4.7, windowIn: 2.5, rotationDeg: -2 },
    { xIn: 2.55, yIn: 6.15, windowIn: 2.3, rotationDeg: 3 },
    { xIn: 6.2, yIn: 6.1, windowIn: 2.4, rotationDeg: -4 },
  ],
  6: [
    { xIn: 2.35, yIn: 2.85, windowIn: 2.2, rotationDeg: -4 },
    { xIn: 4.4, yIn: 2.6, windowIn: 2.1, rotationDeg: 3 },
    { xIn: 6.45, yIn: 2.95, windowIn: 2.2, rotationDeg: -2 },
    { xIn: 2.45, yIn: 6.2, windowIn: 2.2, rotationDeg: 2 },
    { xIn: 4.5, yIn: 6.15, windowIn: 2.3, rotationDeg: -5 },
    { xIn: 6.5, yIn: 6.2, windowIn: 2.1, rotationDeg: 4 },
  ],
};

/** Slot geometry for a page holding `count` photos (1-6). */
export function collageSlots(count: number): CollageSlot[] {
  const table = SLOT_TABLES[count];
  if (!table) {
    throw new Error(`collageSlots: count must be 1-${MAX_COLLAGE_PHOTOS_PER_PAGE}, got ${count}`);
  }
  return table;
}

export interface CollagePlan {
  /** Photos on each collage page, in order (e.g. 11 photos → [6, 5]). */
  perPage: number[];
  /** Photos beyond the 12-photo cap, dropped from the collage (log them). */
  dropped: number;
}

/**
 * How many collage pages a book gets, and how the photos split across them.
 * 0 photos → no collage; 1-6 → one page; 7-12 → two balanced pages
 * (larger half first); >12 → two pages of six, rest dropped (curated-12,
 * owner decision 2026-07-11).
 */
export function planCollage(photoCount: number): CollagePlan {
  if (photoCount <= 0) return { perPage: [], dropped: 0 };
  const kept = Math.min(photoCount, MAX_COLLAGE_PHOTOS);
  const dropped = photoCount - kept;
  if (kept <= MAX_COLLAGE_PHOTOS_PER_PAGE) return { perPage: [kept], dropped };
  const first = Math.ceil(kept / 2);
  return { perPage: [first, kept - first], dropped };
}

/**
 * Collage pages to include in the PRINTED book: the plan's page count, or 0
 * when adding them would push the padded saddle-stitch total past Lulu's 48
 * (only N=23 today). Single authority used by checkout pricing, the
 * lulu-interior route, and the print-fulfillment worker so the priced page
 * count always matches the shipped PDF.
 */
export function collagePagesForPrint(photoCount: number): number {
  const pages = planCollage(photoCount).perPage.length;
  if (pages === 0) return 0;
  const padded = calculatePrintedPageCount(photoCount, {
    padToMultipleOf4: true,
    collagePages: pages,
  });
  return padded <= 48 ? pages : 0;
}

/** Page counts for the printed book, collage-aware. One call site truth. */
export interface PrintPageCounts {
  /** Collage pages actually included (0 when disabled or over the cap). */
  collagePages: number;
  /** Interior pages before saddle-stitch padding. */
  interiorPages: number;
  /** Final padded page count (the number Lulu binds and PrintOrder stores). */
  paddedPages: number;
}

/**
 * The one way every surface computes printed page counts. `collageEnabled`
 * is the caller's flag (COLLAGE_PAGES_ENABLED server-side,
 * NEXT_PUBLIC_COLLAGE_PAGES_ENABLED in client components) so the priced,
 * displayed, and shipped counts can never disagree.
 */
export function printPageCounts(photoCount: number, collageEnabled: boolean): PrintPageCounts {
  const collagePages = collageEnabled ? collagePagesForPrint(photoCount) : 0;
  return {
    collagePages,
    interiorPages: calculatePrintedPageCount(photoCount, { collagePages }),
    paddedPages: calculatePrintedPageCount(photoCount, {
      padToMultipleOf4: true,
      collagePages,
    }),
  };
}
