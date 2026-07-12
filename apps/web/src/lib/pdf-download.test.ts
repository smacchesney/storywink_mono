import { describe, it, expect } from 'vitest';
import { pdfDownloadFileName } from './pdf-download';

describe('pdfDownloadFileName', () => {
  it('appends .pdf to a plain title', () => {
    expect(pdfDownloadFileName('My Book')).toBe('My Book.pdf');
  });

  it('keeps Japanese titles as-is (download attr accepts unicode)', () => {
    expect(pdfDownloadFileName('カイのぼうけん')).toBe('カイのぼうけん.pdf');
  });

  it('falls back to "book" for null, empty, or whitespace titles', () => {
    expect(pdfDownloadFileName(null)).toBe('book.pdf');
    expect(pdfDownloadFileName(undefined)).toBe('book.pdf');
    expect(pdfDownloadFileName('   ')).toBe('book.pdf');
  });

  it('replaces filesystem-reserved characters with spaces', () => {
    expect(pdfDownloadFileName('cats/dogs: a "tail" <of> two?')).toBe(
      'cats dogs a tail of two.pdf',
    );
  });

  it('strips control characters and collapses runs of whitespace', () => {
    expect(pdfDownloadFileName('Kai\u0000 and\u0007 Momo')).toBe('Kai and Momo.pdf');
    expect(pdfDownloadFileName('a\tb   c')).toBe('ab c.pdf');
  });

  it('trims trailing dots and spaces before the extension', () => {
    expect(pdfDownloadFileName('The End...')).toBe('The End.pdf');
    expect(pdfDownloadFileName('The End . ')).toBe('The End.pdf');
  });
});
