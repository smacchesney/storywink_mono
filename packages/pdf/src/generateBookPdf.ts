/**
 * Generates book interior PDFs. Single source of truth for both the Lulu
 * print path (workers) and the user PDF export path (web).
 *
 * Supports two modes via options:
 * - Lulu mode (default): dedication → text/illustration pairs → padded to 4x.
 *   Title page excluded (it lives on the cover spread).
 * - User mode: titlePage → dedication → text/illustration pairs → back cover,
 *   no padding.
 *
 * Uses Puppeteer to render HTML pages to PDF.
 * Specifications: 8.5"x8.5" with 0.125" bleed (8.75"x8.75" total).
 */

import type { BookWithPages, GenerateBookPdfOptions } from './types.js';
import {
  PAGE_WIDTH_WITH_BLEED_IN,
  PAGE_HEIGHT_WITH_BLEED_IN,
  PAGE_WIDTH_PX,
  PAGE_HEIGHT_PX,
} from './constants.js';
import { buildInteriorFontFaces } from './fonts.js';
import { assembleInteriorPages } from './pages.js';
import { renderPdf } from './browser.js';
import { resolveLogger } from './logger.js';

/**
 * Generates a PDF buffer for the given book data.
 *
 * @param bookData - Book with pages.
 * @param options  - Fonts (required) plus layout controls. See
 *                    {@link GenerateBookPdfOptions}.
 */
export async function generateBookPdf(
  bookData: BookWithPages,
  options: GenerateBookPdfOptions
): Promise<Buffer> {
  const { fonts, titlePage, includeBackCover = false, padToFour = true, imageUrlTransform } = options;
  const log = resolveLogger(options.logger);

  log.info({ bookId: bookData.id, hasTitle: !!titlePage, includeBackCover, padToFour }, 'Starting PDF generation...');

  try {
    const language = bookData.language || 'en';

    // Build @font-face blocks from injected font bytes.
    const fontFaces = buildInteriorFontFaces(fonts, language);

    // Assemble the ordered interior page array (pure, testable).
    const pages = assembleInteriorPages(bookData, {
      titlePage,
      includeBackCover,
      padToFour,
      imageUrlTransform,
    });
    const pageHtmlArray = pages.map((p) => p.html);

    // Compose the full HTML document.
    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${bookData.title || 'My Storybook'}</title>
        <style>
          ${fontFaces}
          body { margin: 0; padding: 0; }
        </style>
      </head>
      <body>
        ${pageHtmlArray.join('\n')}
      </body>
      </html>
    `;

    log.info({ bookId: bookData.id, totalPdfPages: pageHtmlArray.length }, 'Launching browser...');

    const pdfBuffer = await renderPdf({
      html: fullHtml,
      viewportWidthPx: PAGE_WIDTH_PX,
      viewportHeightPx: PAGE_HEIGHT_PX,
      pdfWidthIn: `${PAGE_WIDTH_WITH_BLEED_IN}in`,
      pdfHeightIn: `${PAGE_HEIGHT_WITH_BLEED_IN}in`,
    });

    log.info(
      { bookId: bookData.id, bufferSize: pdfBuffer.length, pageCount: pageHtmlArray.length },
      'PDF buffer generated.'
    );

    return pdfBuffer;
  } catch (error: unknown) {
    const err = error as Error;
    log.error(
      { bookId: bookData.id, errorMessage: err.message, errorStack: err.stack, errorName: err.name },
      'Error during PDF generation'
    );
    throw new Error(`Failed to generate PDF: ${err.message}`);
  }
}
