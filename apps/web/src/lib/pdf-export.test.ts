import { describe, it, expect } from 'vitest';
import {
  optimizeForScreen,
  pdfContentDisposition,
  syntheticTitlePage,
  SCREEN_IMAGE_TRANSFORM,
} from './pdf-export';

describe('optimizeForScreen', () => {
  it('inserts the screen transform into Cloudinary upload URLs', () => {
    expect(
      optimizeForScreen('https://res.cloudinary.com/storywink/image/upload/v1/page-1.png'),
    ).toBe(
      `https://res.cloudinary.com/storywink/image/upload/${SCREEN_IMAGE_TRANSFORM}/v1/page-1.png`,
    );
  });

  it('is JPEG passthrough at illustrator-native width', () => {
    expect(SCREEN_IMAGE_TRANSFORM).toBe('f_jpg,q_auto:good,w_2048,c_limit');
  });

  it('returns non-Cloudinary URLs unchanged', () => {
    expect(optimizeForScreen('https://example.com/upload/pic.png')).toBe(
      'https://example.com/upload/pic.png',
    );
    expect(optimizeForScreen('')).toBe('');
  });
});

describe('pdfContentDisposition', () => {
  it('quotes ASCII titles and mirrors them in filename*', () => {
    expect(pdfContentDisposition('My Book')).toBe(
      `attachment; filename="My Book.pdf"; filename*=UTF-8''My%20Book.pdf`,
    );
  });

  it('keeps the header latin1-safe for Japanese titles (no raw non-ASCII)', () => {
    const header = pdfContentDisposition('カイのぼうけん');
    // Bare filename falls back to ASCII; the real title rides filename*.
    expect(header).toContain('filename="book.pdf"');
    expect(header).toContain(
      `filename*=UTF-8''%E3%82%AB%E3%82%A4%E3%81%AE%E3%81%BC%E3%81%86%E3%81%91%E3%82%93.pdf`,
    );
    // eslint-disable-next-line no-control-regex
    expect(header).toMatch(/^[\x00-\x7f]*$/);
  });

  it('strips quote/backslash/separator characters from the fallback filename', () => {
    const header = pdfContentDisposition('A "quoted"; b\\c');
    expect(header).toContain('filename="A quoted bc.pdf"');
  });

  it("percent-encodes RFC 5987 non-attr-chars ('()*) in filename*", () => {
    const header = pdfContentDisposition("Kai's (best) *day*");
    expect(header).toContain(`filename*=UTF-8''Kai%27s%20%28best%29%20%2Aday%2A.pdf`);
  });

  it('falls back to "book" for empty or whitespace titles', () => {
    expect(pdfContentDisposition(null)).toBe(
      `attachment; filename="book.pdf"; filename*=UTF-8''book.pdf`,
    );
    expect(pdfContentDisposition('   ')).toBe(
      `attachment; filename="book.pdf"; filename*=UTF-8''book.pdf`,
    );
  });
});

describe('syntheticTitlePage (X17 A5)', () => {
  const coverPage = { id: 'p1', pageNumber: 1, generatedImageUrl: 'render.png' } as never;

  it('legacy: the resolved cover page wins; coverImageUrl overrides its render', () => {
    expect(syntheticTitlePage(coverPage, 'cover.png')).toMatchObject({
      id: 'p1',
      generatedImageUrl: 'cover.png',
    });
    expect(syntheticTitlePage(coverPage, null)).toMatchObject({ generatedImageUrl: 'render.png' });
  });

  it('composed: synthesizes a page-0 stub from coverImageUrl', () => {
    expect(syntheticTitlePage(undefined, 'cover.png')).toMatchObject({
      pageNumber: 0,
      generatedImageUrl: 'cover.png',
    });
  });

  it('no cover anywhere: undefined — the export opens on the dedication', () => {
    expect(syntheticTitlePage(undefined, null)).toBeUndefined();
  });
});
