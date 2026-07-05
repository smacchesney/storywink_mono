/**
 * Pure helpers for how a book presents itself outside the reader.
 * Kept free of React/Next imports so they stay unit-testable.
 */

export interface CoverSourceBook {
  coverImageUrl?: string | null;
  pages: Array<{
    originalImageUrl?: string | null;
    generatedImageUrl?: string | null;
    isTitlePage?: boolean;
  }>;
}

/**
 * The book's face, in fidelity order: the dedicated painted cover, the
 * title page's illustration, any illustration, the title page's photo,
 * then any photo.
 */
export function resolveCoverImageUrl(book: CoverSourceBook): string | null {
  if (book.coverImageUrl) return book.coverImageUrl;
  const titlePage = book.pages.find((p) => p.isTitlePage);
  if (titlePage?.generatedImageUrl) return titlePage.generatedImageUrl;
  const firstGenerated = book.pages.find((p) => p.generatedImageUrl);
  if (firstGenerated?.generatedImageUrl) return firstGenerated.generatedImageUrl;
  if (titlePage?.originalImageUrl) return titlePage.originalImageUrl;
  return book.pages.find((p) => p.originalImageUrl)?.originalImageUrl ?? null;
}

export interface FingerprintBook {
  status: string;
  title?: string | null;
  childName?: string | null;
  language?: string | null;
  coverImageUrl?: string | null;
  pages: Array<{
    id: string;
    text?: string | null;
    generatedImageUrl?: string | null;
    moderationStatus?: string | null;
  }>;
}

/**
 * Content fingerprint for a fetched book. The preview only swaps its book
 * state when this changes, so `book.pages` keeps its identity during a read
 * and react-pageflip never reloads every page mid-flip.
 */
export function bookContentFingerprint(book: FingerprintBook): string {
  return JSON.stringify([
    book.status,
    book.title ?? null,
    book.childName ?? null,
    book.language ?? null,
    book.coverImageUrl ?? null,
    book.pages.map((p) => [
      p.id,
      p.text ?? null,
      p.generatedImageUrl ?? null,
      p.moderationStatus ?? null,
    ]),
  ]);
}
