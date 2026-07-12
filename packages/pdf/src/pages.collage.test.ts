import { describe, it, expect } from 'vitest';
import { assembleInteriorPages } from './pages.js';
import {
  collectCollagePhotos,
  collageCellUrl,
  collageSubline,
  generateCollagePagesHtml,
} from './collage-page.js';
import type { BookWithPages, Page } from './types.js';

type CollagePage = Page & { asset?: { url: string } | null };

function makePage(i: number, overrides: Partial<CollagePage> = {}): CollagePage {
  return {
    id: `page-${i}`,
    pageNumber: i,
    index: i - 1,
    assetId: `asset-${i}`,
    text: `Story text ${i}`,
    generatedImageUrl: `https://res.cloudinary.com/storywink/image/upload/v1/page-${i}.png`,
    originalImageUrl: `https://res.cloudinary.com/storywink/image/upload/w_200,h_200,c_fill/v1/orig-${i}.jpg`,
    source: 'PHOTO',
    textConfirmed: true,
    pageType: 'SINGLE',
    isTitlePage: i === 1,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    bookId: 'book-1',
    moderationStatus: 'APPROVED',
    moderationReason: null,
    illustrationNotes: null,
    asset: { url: `https://res.cloudinary.com/storywink/image/upload/v1/orig-${i}.jpg` },
    ...overrides,
  } as unknown as CollagePage;
}

function makeBook(
  n: number,
  pageOverrides: (i: number) => Partial<CollagePage> = () => ({}),
): BookWithPages {
  return {
    id: 'book-1',
    title: 'Test Book',
    childName: 'Kai',
    coverAssetId: 'asset-1',
    language: 'en',
    createdAt: new Date('2026-07-05T00:00:00Z'),
    pages: Array.from({ length: n }, (_, i) => makePage(i + 1, pageOverrides(i + 1))),
  } as unknown as BookWithPages;
}

describe('collectCollagePhotos', () => {
  it('keeps PHOTO pages with asset urls, in page order', () => {
    const photos = collectCollagePhotos(makeBook(3));
    expect(photos.map((p) => p.url)).toEqual([
      'https://res.cloudinary.com/storywink/image/upload/v1/orig-1.jpg',
      'https://res.cloudinary.com/storywink/image/upload/v1/orig-2.jpg',
      'https://res.cloudinary.com/storywink/image/upload/v1/orig-3.jpg',
    ]);
  });

  it('skips bridge pages and pages without a loaded asset', () => {
    const book = makeBook(4, (i) =>
      i === 2 ? { source: 'BRIDGE', assetId: null, asset: null } : i === 3 ? { asset: null } : {},
    );
    expect(collectCollagePhotos(book)).toHaveLength(2);
  });
});

describe('collageCellUrl', () => {
  it('inserts an exact-size face-centered jpg fill crop', () => {
    expect(
      collageCellUrl('https://res.cloudinary.com/storywink/image/upload/v1/orig.jpg', 2.5),
    ).toBe(
      'https://res.cloudinary.com/storywink/image/upload/f_jpg,q_auto:good,c_lfill,w_750,h_750,g_auto:faces/v1/orig.jpg',
    );
  });

  it('passes non-cloudinary urls through', () => {
    expect(collageCellUrl('https://example.com/x.jpg', 2.5)).toBe('https://example.com/x.jpg');
  });
});

describe('collageSubline', () => {
  it('formats en and ja month-year', () => {
    const d = new Date('2026-07-05T00:00:00Z');
    expect(collageSubline(d, 'en')).toBe('July 2026');
    expect(collageSubline(d, 'ja')).toBe('2026年7月');
  });
});

describe('generateCollagePagesHtml', () => {
  it('renders one page for 6 photos, heading and mascot together', () => {
    const pages = generateCollagePagesHtml(makeBook(6));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('The real adventure');
    expect(pages[0]).toContain('July 2026');
    expect(pages[0]).toContain('Storywink mascot');
    expect(pages[0]).toContain('c_lfill');
  });

  it('renders two pages for 10 photos: heading on the first, mascot on the last', () => {
    const pages = generateCollagePagesHtml(makeBook(10));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('The real adventure');
    expect(pages[0]).not.toContain('Storywink mascot');
    expect(pages[1]).not.toContain('The real adventure');
    expect(pages[1]).toContain('Storywink mascot');
  });

  it('caps at 12 photos across the unit', () => {
    const pages = generateCollagePagesHtml(makeBook(20));
    const cells = pages.join('').match(/c_lfill/g) ?? [];
    expect(cells).toHaveLength(12);
  });

  it('renders nothing when no photos are eligible', () => {
    expect(generateCollagePagesHtml(makeBook(2, () => ({ asset: null })))).toEqual([]);
  });
});

describe('assembleInteriorPages — collage insertion', () => {
  it('default path is byte-identical with the option absent or false', () => {
    const html = (opts?: Parameters<typeof assembleInteriorPages>[1]) =>
      assembleInteriorPages(makeBook(4), opts)
        .map((p) => p.html)
        .join('\n');
    expect(html({ includeCollage: false })).toBe(html());
    expect(html()).not.toContain('The real adventure');
  });

  it('inserts collage after ending, before back cover and padding', () => {
    const kinds = assembleInteriorPages(makeBook(4), {
      includeCollage: true,
      includeBackCover: true,
      padToFour: false,
    }).map((p) => p.kind);
    expect(kinds).toEqual([
      'dedication',
      'text',
      'illustration',
      'text',
      'illustration',
      'text',
      'illustration',
      'text',
      'illustration',
      'ending',
      'collage',
      'backCover',
    ]);
  });

  it('even photo counts: Lulu total pages unchanged (collage absorbs pad slots)', () => {
    const without = assembleInteriorPages(makeBook(10));
    const withCollage = assembleInteriorPages(makeBook(10), { includeCollage: true });
    expect(without).toHaveLength(24); // 22 + 2 blanks
    expect(withCollage).toHaveLength(24); // 22 + 2 collage, 0 blanks
    expect(withCollage.filter((p) => p.kind === 'collage')).toHaveLength(2);
    expect(withCollage.filter((p) => p.kind === 'blank')).toHaveLength(0);
  });

  it('odd photo counts: collage costs one sheet (4 pages) on the Lulu path', () => {
    const without = assembleInteriorPages(makeBook(9));
    const withCollage = assembleInteriorPages(makeBook(9), { includeCollage: true });
    expect(without).toHaveLength(20);
    expect(withCollage).toHaveLength(24); // +2 collage, +2 blanks
  });
});
