import { describe, it, expect } from 'vitest';
import { resolveCoverImageUrl, bookContentFingerprint } from './book-display';

const page = (over: Partial<Parameters<typeof resolveCoverImageUrl>[0]['pages'][number]> = {}) => ({
  originalImageUrl: null,
  generatedImageUrl: null,
  isTitlePage: false,
  ...over,
});

describe('resolveCoverImageUrl', () => {
  it('prefers the dedicated painted cover over everything else', () => {
    expect(
      resolveCoverImageUrl({
        coverImageUrl: 'cover.png',
        pages: [page({ isTitlePage: true, generatedImageUrl: 'title.png' })],
      }),
    ).toBe('cover.png');
  });

  it('falls back to the title page illustration', () => {
    expect(
      resolveCoverImageUrl({
        coverImageUrl: null,
        pages: [
          page({ generatedImageUrl: 'story1.png' }),
          page({ isTitlePage: true, generatedImageUrl: 'title.png' }),
        ],
      }),
    ).toBe('title.png');
  });

  it('falls back to any illustration when the title page has none', () => {
    expect(
      resolveCoverImageUrl({
        pages: [
          page({ isTitlePage: true, originalImageUrl: 'title-photo.jpg' }),
          page({ generatedImageUrl: 'story2.png' }),
        ],
      }),
    ).toBe('story2.png');
  });

  it('falls back to the title-page photo, then any photo', () => {
    expect(
      resolveCoverImageUrl({
        pages: [
          page({ originalImageUrl: 'first-photo.jpg' }),
          page({ isTitlePage: true, originalImageUrl: 'title-photo.jpg' }),
        ],
      }),
    ).toBe('title-photo.jpg');
    expect(
      resolveCoverImageUrl({
        pages: [page(), page({ originalImageUrl: 'only-photo.jpg' })],
      }),
    ).toBe('only-photo.jpg');
  });

  it('returns null for a book with no images at all', () => {
    expect(resolveCoverImageUrl({ pages: [page()] })).toBeNull();
  });
});

describe('bookContentFingerprint', () => {
  const base = {
    status: 'COMPLETED',
    title: 'A Day Out',
    childName: 'Mia',
    language: 'en',
    coverImageUrl: 'cover.png',
    pages: [
      { id: 'p1', text: 'Off we go!', generatedImageUrl: 'p1.png', moderationStatus: 'OK' },
      { id: 'p2', text: 'Splash!', generatedImageUrl: 'p2.png', moderationStatus: 'OK' },
    ],
  };

  it('is stable across refetches of identical content', () => {
    const clone = JSON.parse(JSON.stringify(base));
    expect(bookContentFingerprint(base)).toBe(bookContentFingerprint(clone));
  });

  it('changes when a page image, text, or the status changes', () => {
    const withImage = {
      ...base,
      pages: [base.pages[0], { ...base.pages[1], generatedImageUrl: 'p2-v2.png' }],
    };
    expect(bookContentFingerprint(withImage)).not.toBe(bookContentFingerprint(base));

    const withText = {
      ...base,
      pages: [{ ...base.pages[0], text: 'Away we go!' }, base.pages[1]],
    };
    expect(bookContentFingerprint(withText)).not.toBe(bookContentFingerprint(base));

    expect(bookContentFingerprint({ ...base, status: 'ILLUSTRATING' })).not.toBe(
      bookContentFingerprint(base),
    );
  });

  it('changes when display-affecting book fields change', () => {
    expect(bookContentFingerprint({ ...base, title: 'New Title' })).not.toBe(
      bookContentFingerprint(base),
    );
    expect(bookContentFingerprint({ ...base, coverImageUrl: null })).not.toBe(
      bookContentFingerprint(base),
    );
  });
});
