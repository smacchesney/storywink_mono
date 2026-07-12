import type { PdfFonts } from './types.js';

/** Maps a font container format to its data-URI MIME type. */
function fontMime(format: 'woff2' | 'truetype'): string {
  return format === 'woff2' ? 'font/woff2' : 'font/truetype';
}

/**
 * Builds the `@font-face` CSS blocks embedded in the interior PDF `<head>`.
 *
 * Only the fonts needed for the given language are emitted:
 * - Excalifont: always (branding text on dedication/ending).
 * - Andika: non-Japanese only (English story body).
 * - Zen Maru Gothic: Japanese only.
 */
export function buildInteriorFontFaces(fonts: PdfFonts, language: string): string {
  const excalifontFace = fonts.excalifontBase64
    ? `@font-face {
          font-family: 'Excalifont';
          src: url(data:${fontMime(fonts.excalifontFormat)};base64,${fonts.excalifontBase64}) format('${fonts.excalifontFormat}');
          font-weight: normal;
          font-style: normal;
        }`
    : '';

  const andikaFace =
    language !== 'ja' && fonts.andikaBase64
      ? `@font-face {
          font-family: 'Andika';
          src: url(data:font/truetype;base64,${fonts.andikaBase64}) format('truetype');
          font-weight: normal;
          font-style: normal;
        }`
      : '';

  const zenMaruFace =
    language === 'ja' && fonts.zenMaruGothicBase64
      ? `@font-face {
            font-family: 'Zen Maru Gothic';
            src: url(data:font/truetype;base64,${fonts.zenMaruGothicBase64}) format('truetype');
            font-weight: normal;
            font-style: normal;
          }`
      : '';

  return [excalifontFace, andikaFace, zenMaruFace].filter(Boolean).join('\n');
}

/** Builds the single `@font-face` block used by the cover spread (Excalifont only). */
export function buildCoverFontFace(
  fonts: Pick<PdfFonts, 'excalifontBase64' | 'excalifontFormat'>,
): string {
  return fonts.excalifontBase64
    ? `@font-face {
        font-family: 'Excalifont';
        src: url(data:${fontMime(fonts.excalifontFormat)};base64,${fonts.excalifontBase64}) format('${fonts.excalifontFormat}');
        font-weight: normal;
        font-style: normal;
      }`
    : '';
}
