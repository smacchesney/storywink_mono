/**
 * Helpers for the user-facing PDF export route
 * (`/api/book/[bookId]/export/pdf`). Deliberately NOT in `@storywink/pdf`:
 * the package defaults must keep producing byte-identical Lulu print HTML
 * (frozen by `packages/pdf/src/pages.lulu-snapshot.test.ts`), so the
 * screen-optimized transform lives with the only caller that wants it.
 */

import type { Page } from '@prisma/client';

/**
 * Screen/share-optimized Cloudinary transform.
 *
 * `f_jpg` matters most: Chromium's Skia PDF backend embeds JPEG bytes verbatim
 * (DCT passthrough) but losslessly re-encodes every other format — the default
 * `f_auto` serves WebP, which balloons each full-bleed page to ~9MB of flate.
 * `w_2048,c_limit` is the illustrators' native output resolution (the stored
 * 2625px asset is a lanczos upscale), 234 DPI at 8.75in. Net: ~95MB → ~4MB for
 * a 10-photo book. If a style ever compresses badly, bump to `q_auto:best`.
 */
export const SCREEN_IMAGE_TRANSFORM = 'f_jpg,q_auto:good,w_2048,c_limit';

/** Applies {@link SCREEN_IMAGE_TRANSFORM} to Cloudinary URLs; others pass through. */
export function optimizeForScreen(url: string): string {
  if (!url.includes('/image/upload/')) return url;
  return url.replace('/upload/', `/upload/${SCREEN_IMAGE_TRANSFORM}/`);
}

/**
 * Content-Disposition for the exported PDF that survives non-ASCII titles.
 * Node rejects header values outside latin1, so a Japanese title in a bare
 * `filename="…"` hard-500s the route. Per RFC 5987/6266: ASCII fallback in
 * `filename`, full UTF-8 title percent-encoded in `filename*`.
 */
export function pdfContentDisposition(title: string | null | undefined): string {
  const base = (title || '').trim() || 'book';
  const asciiBase =
    base
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/[",;\\]/g, '')
      .trim() || 'book';
  // encodeURIComponent leaves '()* unencoded, but they are not RFC 5987
  // attr-chars, so escape them explicitly.
  const encoded = encodeURIComponent(`${base}.pdf`).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiBase}.pdf"; filename*=UTF-8''${encoded}`;
}

/**
 * X17 A5: resolve the user export's opening page. Legacy books keep the
 * resolved cover page (coverImageUrl overriding its interior render, as
 * before). Composed-cover books have NO title-page row — synthesize a
 * page-0 stub from Book.coverImageUrl so the export still opens with the
 * cover. No cover anywhere: undefined (the export opens on the dedication).
 */
export function syntheticTitlePage(
  coverPage: (Page & { generatedImageUrl: string | null }) | undefined,
  coverImageUrl: string | null,
): Page | undefined {
  if (coverPage) {
    return { ...coverPage, generatedImageUrl: coverImageUrl || coverPage.generatedImageUrl };
  }
  if (!coverImageUrl) return undefined;
  return { pageNumber: 0, generatedImageUrl: coverImageUrl } as unknown as Page;
}
