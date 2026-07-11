import { describe, it, expect } from 'vitest';
import {
  assembleInteriorPages,
  generateBackCoverPageHtml,
  generateDedicationPageHtml,
  generateEndingPageHtml,
  generateIllustrationPageHtml,
} from './pages.js';
import type { BookWithPages, Page } from './types.js';
import {
  BACK_COVER_MASCOT_URL,
  DEDICATION_MASCOT_URL,
  ENDING_MASCOT_URL,
} from './constants.js';

const tag = (url: string) => `${url}#t`;

function makePage(i: number): Page {
  return {
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
  } as unknown as Page;
}

function makeBook(n: number): BookWithPages {
  return {
    id: 'book-1',
    title: 'Test Book',
    childName: 'Kai',
    coverAssetId: 'asset-1',
    language: 'en',
    pages: Array.from({ length: n }, (_, i) => makePage(i + 1)),
  } as unknown as BookWithPages;
}

describe('generateIllustrationPageHtml — imageUrlTransform', () => {
  it('default applies optimizeForPrint (f_jpg,q_auto:best)', () => {
    const html = generateIllustrationPageHtml(makePage(1));
    expect(html).toContain(
      'https://res.cloudinary.com/storywink/image/upload/f_jpg,q_auto:best/v1/page-1.png'
    );
  });

  it('a supplied transform replaces optimizeForPrint entirely', () => {
    const html = generateIllustrationPageHtml(makePage(1), tag);
    expect(html).toContain(
      'https://res.cloudinary.com/storywink/image/upload/v1/page-1.png#t'
    );
    expect(html).not.toContain('f_jpg');
  });
});

describe('mascot pages — imageUrlTransform', () => {
  it('defaults emit the raw mascot URLs (no transform)', () => {
    expect(generateDedicationPageHtml('Kai', 'Test Book', 'en')).toContain(
      `src="${DEDICATION_MASCOT_URL}"`
    );
    expect(generateEndingPageHtml('Kai', 'Test Book', 'en')).toContain(
      `src="${ENDING_MASCOT_URL}"`
    );
    expect(generateBackCoverPageHtml()).toContain(`src="${BACK_COVER_MASCOT_URL}"`);
  });

  it('a supplied transform is applied to every mascot URL', () => {
    expect(generateDedicationPageHtml('Kai', 'Test Book', 'en', tag)).toContain(
      `src="${DEDICATION_MASCOT_URL}#t"`
    );
    expect(generateEndingPageHtml('Kai', 'Test Book', 'en', tag)).toContain(
      `src="${ENDING_MASCOT_URL}#t"`
    );
    expect(generateBackCoverPageHtml(tag)).toContain(`src="${BACK_COVER_MASCOT_URL}#t"`);
  });
});

describe('assembleInteriorPages — imageUrlTransform threading', () => {
  it('applies the transform to every illustration (incl. title) and every mascot', () => {
    const book = makeBook(3);
    const html = assembleInteriorPages(book, {
      titlePage: book.pages[0],
      includeBackCover: true,
      padToFour: false,
      imageUrlTransform: tag,
    })
      .map((p) => p.html)
      .join('\n');

    for (let i = 1; i <= 3; i++) {
      expect(html).toContain(
        `https://res.cloudinary.com/storywink/image/upload/v1/page-${i}.png#t`
      );
    }
    expect(html).toContain(`${DEDICATION_MASCOT_URL}#t`);
    expect(html).toContain(`${ENDING_MASCOT_URL}#t`);
    expect(html).toContain(`${BACK_COVER_MASCOT_URL}#t`);
    // Nothing slipped through on the default transform.
    expect(html).not.toContain('f_jpg');
  });

  it('omitted transform produces HTML strict-equal to the pre-option call', () => {
    const withUndefined = assembleInteriorPages(makeBook(4), { imageUrlTransform: undefined })
      .map((p) => p.html)
      .join('\n');
    const withoutOption = assembleInteriorPages(makeBook(4))
      .map((p) => p.html)
      .join('\n');
    expect(withUndefined).toBe(withoutOption);
  });
});
