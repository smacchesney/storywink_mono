import { describe, it, expect } from 'vitest';
import { assembleInteriorPages } from './pages.js';
import type { BookWithPages, Page } from './types.js';
import { DEDICATION_MASCOT_URL, ENDING_MASCOT_URL } from './constants.js';

/**
 * Freezes the exact interior HTML the Lulu print path renders (default
 * assembleInteriorPages options: no title page, no back cover, padded to 4x).
 * Lulu consumes these rendering inputs verbatim — any diff here means the
 * printed book changes, so treat a snapshot failure as a production incident,
 * not a test to update casually.
 *
 * Fixture URLs are deliberately Cloudinary-shaped: optimizeForPrint only
 * rewrites URLs containing `/image/upload/`, so an example.com fixture would
 * bypass it and the frozen HTML would never contain the
 * `/upload/f_jpg,q_auto:best/` transform this snapshot exists to guard.
 */
function makeLuluBook(n: number): BookWithPages {
  const pages: Page[] = [];
  for (let i = 1; i <= n; i++) {
    pages.push({
      id: `page-${i}`,
      pageNumber: i,
      index: i - 1,
      assetId: `asset-${i}`,
      text: `Story text ${i}`,
      generatedImageUrl: `https://res.cloudinary.com/storywink/image/upload/v1/page-${i}.png`,
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

/** Mirrors generateBookPdf's document assembly: page HTML joined with '\n'. */
function luluInteriorHtml(n: number): string {
  return assembleInteriorPages(makeLuluBook(n))
    .map((p) => p.html)
    .join('\n');
}

describe('Lulu interior HTML — frozen rendering inputs (default path)', () => {
  it('N=3: assembled HTML matches the frozen snapshot', () => {
    expect(luluInteriorHtml(3)).toMatchSnapshot();
  });

  it('N=10: assembled HTML matches the frozen snapshot', () => {
    expect(luluInteriorHtml(10)).toMatchSnapshot();
  });

  it('every illustration carries the print transform; mascots stay raw', () => {
    const html = luluInteriorHtml(10);
    for (let i = 1; i <= 10; i++) {
      expect(html).toContain(
        `https://res.cloudinary.com/storywink/image/upload/f_jpg,q_auto:best/v1/page-${i}.png`
      );
    }
    // Raw mascot URLs are NOT substrings of their transformed forms, so
    // toContain also proves no transform was applied to them.
    expect(html).toContain(DEDICATION_MASCOT_URL);
    expect(html).toContain(ENDING_MASCOT_URL);
  });
});
