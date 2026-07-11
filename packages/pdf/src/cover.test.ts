import { describe, it, expect } from 'vitest';
import { resolveCoverImageUrl, generateCoverHtml } from './cover.js';
import type { BookWithPages, Page } from './types.js';

function page(overrides: Partial<Page>): Page {
  return {
    id: 'p',
    pageNumber: 1,
    index: 0,
    assetId: 'asset-1',
    text: null,
    generatedImageUrl: null,
    originalImageUrl: null,
    textConfirmed: true,
    pageType: 'SINGLE',
    isTitlePage: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    bookId: 'book-1',
    moderationStatus: 'APPROVED',
    moderationReason: null,
    illustrationNotes: null,
    ...overrides,
  } as unknown as Page;
}

function book(overrides: Partial<BookWithPages>): BookWithPages {
  return {
    id: 'book-1',
    title: 'Test Book',
    childName: 'Kai',
    coverAssetId: 'asset-1',
    coverImageUrl: null,
    language: 'en',
    pages: [],
    ...overrides,
  } as unknown as BookWithPages;
}

describe('resolveCoverImageUrl', () => {
  it('prefers Book.coverImageUrl when present', () => {
    const b = book({
      coverImageUrl: 'https://example.com/dedicated-cover.png',
      pages: [page({ assetId: 'asset-1', generatedImageUrl: 'https://example.com/page1.png' })],
    });
    expect(resolveCoverImageUrl(b).coverImageUrl).toBe('https://example.com/dedicated-cover.png');
    expect(resolveCoverImageUrl(b).hasTitlePage).toBe(true);
  });

  it('falls back to the cover page illustration', () => {
    const b = book({
      coverImageUrl: null,
      coverAssetId: 'asset-2',
      pages: [
        page({ assetId: 'asset-1', generatedImageUrl: 'https://example.com/page1.png' }),
        page({ assetId: 'asset-2', generatedImageUrl: 'https://example.com/cover-page.png' }),
      ],
    });
    expect(resolveCoverImageUrl(b).coverImageUrl).toBe('https://example.com/cover-page.png');
  });

  it('falls back to the first page when no title page matches', () => {
    const b = book({
      coverImageUrl: null,
      coverAssetId: 'nonexistent',
      pages: [page({ assetId: 'asset-9', generatedImageUrl: 'https://example.com/first.png' })],
    });
    const result = resolveCoverImageUrl(b);
    expect(result.coverImageUrl).toBe('https://example.com/first.png');
    expect(result.hasTitlePage).toBe(false);
  });
});

describe('generateCoverHtml', () => {
  it('embeds the cover image and branding when a URL is present', () => {
    const html = generateCoverHtml('https://res.cloudinary.com/x/image/upload/v1/cover.png', 'My Book', '');
    expect(html).toContain('Storywin');
    expect(html).toContain('k.ai');
    // Print optimization applied to Cloudinary URLs.
    expect(html).toContain('/upload/f_jpg,q_auto:best/');
    expect(html).toContain('alt="Front Cover"');
  });

  it('shows a placeholder when no cover image is available', () => {
    const html = generateCoverHtml(null, 'My Book', '');
    expect(html).toContain('Cover image not available');
  });
});
