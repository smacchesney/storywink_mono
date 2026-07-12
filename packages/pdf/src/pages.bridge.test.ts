import { describe, it, expect } from 'vitest';
import { calculatePrintedPageCount } from '@storywink/shared/utils';
import { assembleInteriorPages } from './pages.js';
import type { BookWithPages, Page } from './types.js';

/**
 * Golden fixtures locking the pairing/padding contract for BRIDGE pages:
 * fully-illustrated Page rows with assetId=null (source=BRIDGE in the DB).
 * The generators need ZERO changes for bridges — these tests exist to keep
 * it that way. The Lulu snapshot (pages.lulu-snapshot.test.ts) is untouched.
 */

interface RowSpec {
  /** null = bridge row (no source photo, still fully illustrated) */
  assetId: string | null;
}

function makeBookWithRows(rows: RowSpec[]): BookWithPages {
  const pages: Page[] = rows.map(
    (row, i) =>
      ({
        id: `page-${i + 1}`,
        pageNumber: i + 1,
        index: i,
        assetId: row.assetId,
        text: `Story text ${i + 1}`,
        generatedImageUrl: `https://example.com/page-${i + 1}.png`,
        originalImageUrl: null,
        textConfirmed: true,
        pageType: 'SINGLE',
        isTitlePage: i === 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        bookId: 'book-1',
        moderationStatus: 'OK',
        moderationReason: null,
        illustrationNotes: null,
      }) as unknown as Page,
  );

  return {
    id: 'book-1',
    title: 'Bridge Book',
    childName: 'Kai',
    coverAssetId: 'asset-1',
    language: 'en',
    pages,
  } as unknown as BookWithPages;
}

/** 5 photos with one bridge inserted after photo 2 (row 3 has assetId null). */
const MID_BRIDGE_ROWS: RowSpec[] = [
  { assetId: 'asset-1' },
  { assetId: 'asset-2' },
  { assetId: null }, // bridge
  { assetId: 'asset-3' },
  { assetId: 'asset-4' },
  { assetId: 'asset-5' },
];

/** 4 photos with a trailing bridge (last row assetId null). */
const TRAILING_BRIDGE_ROWS: RowSpec[] = [
  { assetId: 'asset-1' },
  { assetId: 'asset-2' },
  { assetId: 'asset-3' },
  { assetId: 'asset-4' },
  { assetId: null }, // trailing bridge — must pair BEFORE the ending page
];

describe('assembleInteriorPages — bridge rows (assetId null, fully illustrated)', () => {
  it('a mid-book bridge pairs like any page: dedication + N text/illustration pairs + ending', () => {
    const book = makeBookWithRows(MID_BRIDGE_ROWS);
    const pages = assembleInteriorPages(book); // Lulu defaults: padded, no title

    const content = pages.filter((p) => p.kind !== 'blank');
    expect(content[0].kind).toBe('dedication');
    expect(content[content.length - 1].kind).toBe('ending');

    // Every row — bridge included — emits exactly one verso text page and
    // one recto illustration page, in row order.
    for (let i = 0; i < MID_BRIDGE_ROWS.length; i++) {
      expect(content[1 + i * 2].kind).toBe('text');
      expect(content[1 + i * 2].pageNumber).toBe(i + 1);
      expect(content[2 + i * 2].kind).toBe('illustration');
      expect(content[2 + i * 2].pageNumber).toBe(i + 1);
    }

    // 2 + 2N with N = ALL rows (photos + bridges), padded to a multiple of 4.
    expect(content.length).toBe(calculatePrintedPageCount(MID_BRIDGE_ROWS.length));
    expect(pages.length % 4).toBe(0);
    expect(pages.length).toBe(
      calculatePrintedPageCount(MID_BRIDGE_ROWS.length, { padToMultipleOf4: true }),
    );
  });

  it('a trailing bridge pairs before the ending page, and padding still lands on x4', () => {
    const book = makeBookWithRows(TRAILING_BRIDGE_ROWS);
    const pages = assembleInteriorPages(book);

    const content = pages.filter((p) => p.kind !== 'blank');
    // Last pair belongs to the bridge row (pageNumber 5), then the ending.
    expect(content[content.length - 3].kind).toBe('text');
    expect(content[content.length - 3].pageNumber).toBe(5);
    expect(content[content.length - 2].kind).toBe('illustration');
    expect(content[content.length - 2].pageNumber).toBe(5);
    expect(content[content.length - 1].kind).toBe('ending');

    expect(pages.length % 4).toBe(0);
    expect(pages.length).toBe(
      calculatePrintedPageCount(TRAILING_BRIDGE_ROWS.length, { padToMultipleOf4: true }),
    );
  });

  it('one bridge on an odd photo count is absorbed by would-be blank padding (same sheet count)', () => {
    // A bridge adds 2 raw interior pages. When the photo-only count already
    // needed blank padding (2+2N not a multiple of 4), the bridge lands in
    // that padding for free; otherwise it buys one more sheet.
    const threePhotos = makeBookWithRows([{ assetId: 'a1' }, { assetId: 'a2' }, { assetId: 'a3' }]);
    const threePhotosOneBridge = makeBookWithRows([
      { assetId: 'a1' },
      { assetId: 'a2' },
      { assetId: null },
      { assetId: 'a3' },
    ]);
    // N=3 → 8 pages (no padding); N=4 → 10 → padded 12 (extra sheet).
    expect(assembleInteriorPages(threePhotos).length).toBe(8);
    expect(assembleInteriorPages(threePhotosOneBridge).length).toBe(12);

    const twoPhotos = makeBookWithRows([{ assetId: 'a1' }, { assetId: 'a2' }]);
    const twoPhotosOneBridge = makeBookWithRows([
      { assetId: 'a1' },
      { assetId: null },
      { assetId: 'a2' },
    ]);
    // N=2 → 6 → padded 8; N=3 → 8 (bridge absorbed by the padding, zero cost).
    expect(assembleInteriorPages(twoPhotos).length).toBe(8);
    expect(assembleInteriorPages(twoPhotosOneBridge).length).toBe(8);
  });

  it('user export path: title → dedication → pairs (bridge included) → ending → back cover, no padding', () => {
    const book = makeBookWithRows(MID_BRIDGE_ROWS);
    const titlePage = book.pages[0];
    const pages = assembleInteriorPages(book, {
      titlePage,
      includeBackCover: true,
      padToFour: false,
    });

    expect(pages[0].kind).toBe('title');
    expect(pages[1].kind).toBe('dedication');
    expect(pages[pages.length - 2].kind).toBe('ending');
    expect(pages[pages.length - 1].kind).toBe('backCover');
    expect(pages.some((p) => p.kind === 'blank')).toBe(false);

    // All 6 rows (incl. the assetId-null bridge) pair up; the title page is
    // its own kind and never double-counts as an illustration page.
    expect(pages.filter((p) => p.kind === 'text')).toHaveLength(MID_BRIDGE_ROWS.length);
    expect(pages.filter((p) => p.kind === 'illustration')).toHaveLength(MID_BRIDGE_ROWS.length);
  });
});
