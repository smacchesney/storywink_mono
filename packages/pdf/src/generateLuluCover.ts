/**
 * Generates the cover PDF for Lulu print-on-demand.
 *
 * Creates a cover spread: back cover (white bg, coral branding) + front cover
 * (title page illustration, full bleed).
 * Specifications: 17.25"x8.75" (back + front, no spine for saddle stitch).
 */

import type { BookWithPages, GenerateLuluCoverOptions } from './types.js';
import { COVER_WIDTH_IN, COVER_HEIGHT_IN, COVER_WIDTH_PX, COVER_HEIGHT_PX } from './constants.js';
import { buildCoverFontFace } from './fonts.js';
import { generateCoverHtml, resolveCoverImageUrl } from './cover.js';
import { renderPdf } from './browser.js';
import { resolveLogger } from './logger.js';

/**
 * Generates a cover PDF buffer for Lulu print-on-demand.
 *
 * @param bookData - Book with pages.
 * @param options  - Fonts (Excalifont) plus optional logger.
 * @returns PDF buffer for the cover spread.
 */
export async function generateLuluCover(
  bookData: BookWithPages,
  options: GenerateLuluCoverOptions,
): Promise<Buffer> {
  const log = resolveLogger(options.logger);
  log.info({ bookId: bookData.id }, 'Starting Lulu cover PDF generation...');

  try {
    const { coverImageUrl, hasTitlePage } = resolveCoverImageUrl(bookData);
    if (!hasTitlePage) {
      log.warn({ bookId: bookData.id }, 'No title page found, using first page as cover');
    }

    const fontFace = buildCoverFontFace(options.fonts);
    const coverHtml = generateCoverHtml(coverImageUrl, bookData.title || 'My Storybook', fontFace);

    log.info({ bookId: bookData.id }, 'Launching browser for cover...');

    const pdfBuffer = await renderPdf({
      html: coverHtml,
      viewportWidthPx: COVER_WIDTH_PX,
      viewportHeightPx: COVER_HEIGHT_PX,
      pdfWidthIn: `${COVER_WIDTH_IN}in`,
      pdfHeightIn: `${COVER_HEIGHT_IN}in`,
    });

    log.info({ bookId: bookData.id, bufferSize: pdfBuffer.length }, 'Cover PDF buffer generated.');

    return pdfBuffer;
  } catch (error: unknown) {
    const err = error as Error;
    log.error(
      {
        bookId: bookData.id,
        errorMessage: err.message,
        errorStack: err.stack,
        errorName: err.name,
      },
      'Error during cover PDF generation',
    );
    throw new Error(`Failed to generate cover PDF: ${err.message}`);
  }
}
