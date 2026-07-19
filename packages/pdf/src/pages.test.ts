import { describe, it, expect } from 'vitest';
import { calculatePrintedPageCount } from '@storywink/shared/utils';
import { assembleInteriorPages, type InteriorPageKind } from './pages.js';
import type { BookWithPages, Page } from './types.js';

/**
 * Builds a minimal Book+pages fixture with N story photos.
 * Page numbers are 1..N; assetId of page 1 doubles as the cover asset so we
 * can exercise the title-page path.
 */
function makeBook(n: number): BookWithPages {
  const pages: Page[] = [];
  for (let i = 1; i <= n; i++) {
    pages.push({
      id: `page-${i}`,
      pageNumber: i,
      index: i - 1,
      assetId: `asset-${i}`,
      text: `Story text ${i}`,
      generatedImageUrl: `https://example.com/page-${i}.png`,
      originalImageUrl: null,
      textConfirmed: true,
      pageType: 'SINGLE',
      isTitlePage: i === 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      bookId: 'book-1',
      moderationStatus: 'APPROVED',
      moderationReason: null,
      illustrationNotes: null,
    } as unknown as Page);
  }

  return {
    id: 'book-1',
    title: 'Test Book',
    childName: 'Kai',
    coverAssetId: 'asset-1',
    language: 'en',
    pages,
  } as unknown as BookWithPages;
}

function kinds(
  book: BookWithPages,
  opts?: Parameters<typeof assembleInteriorPages>[1],
): InteriorPageKind[] {
  return assembleInteriorPages(book, opts).map((p) => p.kind);
}

describe('assembleInteriorPages — Lulu path (padded, no title, no back cover)', () => {
  for (let n = 1; n <= 12; n++) {
    it(`N=${n}: dedication recto, verso-text/recto-illustration pairs, ending, padded to x4`, () => {
      const book = makeBook(n);
      const pages = assembleInteriorPages(book); // defaults: padToFour=true

      // Page 1 must be the dedication (recto / right-hand side), no title page.
      expect(pages[0].kind).toBe('dedication');
      expect(pages.some((p) => p.kind === 'title')).toBe(false);
      expect(pages.some((p) => p.kind === 'backCover')).toBe(false);

      // Strip padding to inspect the content sequence.
      const content = pages.filter((p) => p.kind !== 'blank');

      // Sequence: dedication, then N × [text, illustration], then ending.
      expect(content[0].kind).toBe('dedication');
      for (let i = 0; i < n; i++) {
        const textPage = content[1 + i * 2];
        const illoPage = content[2 + i * 2];
        expect(textPage.kind).toBe('text');
        expect(illoPage.kind).toBe('illustration');
        // Verso text is paired with the recto illustration of the SAME story page.
        expect(textPage.pageNumber).toBe(i + 1);
        expect(illoPage.pageNumber).toBe(i + 1);
      }
      expect(content[content.length - 1].kind).toBe('ending');

      // Content count = dedication + ending + 2N = calculatePrintedPageCount(N).
      expect(content.length).toBe(calculatePrintedPageCount(n));

      // Total (with padding) is a multiple of 4 and matches the padded count.
      expect(pages.length % 4).toBe(0);
      expect(pages.length).toBe(calculatePrintedPageCount(n, { padToMultipleOf4: true }));
    });
  }

  it('N=1: padded to 4 (dedication + text + illustration + ending = 4, no blanks needed)', () => {
    const pages = kinds(makeBook(1));
    expect(pages).toEqual(['dedication', 'text', 'illustration', 'ending']);
  });

  it('N=2: 6 content pages padded to 8 (2 blanks)', () => {
    const pages = kinds(makeBook(2));
    expect(pages).toEqual([
      'dedication',
      'text',
      'illustration',
      'text',
      'illustration',
      'ending',
      'blank',
      'blank',
    ]);
  });

  it('N=3: 8 content pages, already a multiple of 4, no padding', () => {
    const pages = assembleInteriorPages(makeBook(3));
    expect(pages.length).toBe(8);
    expect(pages.some((p) => p.kind === 'blank')).toBe(false);
  });
});

describe('assembleInteriorPages — user export path (title, back cover, no padding)', () => {
  for (let n = 1; n <= 12; n++) {
    it(`N=${n}: title → dedication → pairs → ending → back cover, no padding`, () => {
      const book = makeBook(n);
      const titlePage = book.pages[0];
      const pages = assembleInteriorPages(book, {
        titlePage,
        includeBackCover: true,
        padToFour: false,
      });

      // Order: title first, then dedication.
      expect(pages[0].kind).toBe('title');
      expect(pages[0].pageNumber).toBe(titlePage.pageNumber);
      expect(pages[1].kind).toBe('dedication');

      // Last page is the back cover.
      expect(pages[pages.length - 1].kind).toBe('backCover');

      // No blank padding on the user path.
      expect(pages.some((p) => p.kind === 'blank')).toBe(false);

      // Story pairs sit between dedication and ending.
      const ending = pages.find((p) => p.kind === 'ending')!;
      const endingIdx = pages.indexOf(ending);
      for (let i = 0; i < n; i++) {
        expect(pages[2 + i * 2].kind).toBe('text');
        expect(pages[3 + i * 2].kind).toBe('illustration');
      }
      expect(pages[endingIdx].kind).toBe('ending');

      // Total = title(1) + dedication(1) + 2N + ending(1) + backCover(1).
      expect(pages.length).toBe(1 + calculatePrintedPageCount(n) + 1);
    });
  }

  it('N=1: title → dedication → text → illustration → ending → backCover', () => {
    const book = makeBook(1);
    const pages = kinds(book, {
      titlePage: book.pages[0],
      includeBackCover: true,
      padToFour: false,
    });
    expect(pages).toEqual(['title', 'dedication', 'text', 'illustration', 'ending', 'backCover']);
  });
});

describe('assembleInteriorPages — ordering by pageNumber', () => {
  it('sorts pages by pageNumber before pairing', () => {
    const book = makeBook(3);
    // Shuffle input order; assembly must still emit 1,2,3.
    book.pages = [book.pages[2], book.pages[0], book.pages[1]];
    const pages = assembleInteriorPages(book).filter((p) => p.kind === 'illustration');
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
  });
});

describe('assembleInteriorPages — count authority parity with calculatePrintedPageCount', () => {
  for (let n = 0; n <= 23; n++) {
    it(`N=${n}: unpadded content count matches calculatePrintedPageCount`, () => {
      const book = makeBook(n);
      const content = assembleInteriorPages(book, { padToFour: false }).filter(
        (p) => p.kind !== 'blank',
      );
      expect(content.length).toBe(calculatePrintedPageCount(n));
    });

    it(`N=${n}: padded Lulu count matches calculatePrintedPageCount(pad)`, () => {
      const book = makeBook(n);
      const total = assembleInteriorPages(book, { padToFour: true }).length;
      expect(total).toBe(calculatePrintedPageCount(n, { padToMultipleOf4: true }));
    });
  }
});

describe('composed-cover interior invariants (X17 A5)', () => {
  it('23 photos, no title page: exactly 48 interior pages — the Lulu cap', () => {
    const book = makeBook(23);
    (book as { coverAssetId: string | null }).coverAssetId = null;
    const pages = assembleInteriorPages(book);
    expect(pages).toHaveLength(48); // dedication + 23 pairs + ending, 48 % 4 === 0
    expect(pages.filter((p) => p.kind === 'text')).toHaveLength(23);
    expect(pages.filter((p) => p.kind === 'illustration')).toHaveLength(23);
    expect(pages.filter((p) => p.kind === 'blank')).toHaveLength(0);
  });

  it('interior HTML is byte-identical with and without a coverAssetId', () => {
    const withCover = makeBook(5);
    const without = makeBook(5);
    (without as { coverAssetId: string | null }).coverAssetId = null;
    expect(assembleInteriorPages(without).map((p) => p.html)).toEqual(
      assembleInteriorPages(withCover).map((p) => p.html),
    );
  });
});

describe('ensemble dedication + ending (X17 A2)', () => {
  it('dedication and ending carry the crew name list', () => {
    const book = makeBook(3);
    Object.assign(book, {
      castMode: 'ensemble',
      castMemberIds: ['c1', 'c2', 'c3'],
      characterIdentity: {
        characters: [
          { characterId: 'c1', name: 'Leo' },
          { characterId: 'c2', name: 'Maya' },
          { characterId: 'c3', name: 'Sam' },
        ],
      },
    });
    const pages = assembleInteriorPages(book);
    const dedication = pages.find((p) => p.kind === 'dedication')!.html;
    const ending = pages.find((p) => p.kind === 'ending')!.html;
    expect(dedication).toContain('Leo, Maya &amp; Sam');
    expect(ending).toContain('Leo, Maya &amp; Sam');
  });
});
