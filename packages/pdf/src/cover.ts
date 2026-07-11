import type { BookWithPages } from './types.js';
import { escapeHtml } from './escape.js';
import {
  COVER_WIDTH_IN,
  COVER_HEIGHT_IN,
  PANEL_WIDTH_IN,
  CORAL_COLOR,
  BACK_COVER_MASCOT_URL,
  optimizeForPrint,
} from './constants.js';

/**
 * Resolves the front-cover illustration URL for a book.
 *
 * Prefers the dedicated cover illustration (`Book.coverImageUrl`), then the
 * cover page's generated illustration, then the first page's illustration.
 * Pure — used by the generator and directly testable.
 */
export function resolveCoverImageUrl(bookData: BookWithPages): {
  coverImageUrl: string | null | undefined;
  hasTitlePage: boolean;
} {
  const titlePage = bookData.pages.find((page) => page.assetId === bookData.coverAssetId);
  const coverImageUrl =
    bookData.coverImageUrl || titlePage?.generatedImageUrl || bookData.pages[0]?.generatedImageUrl;
  return { coverImageUrl, hasTitlePage: !!titlePage };
}

/**
 * Builds the full HTML document for the Lulu cover spread.
 *
 * Layout (saddle stitch — no spine):
 * +------------------+------------------+
 * |   BACK COVER     |   FRONT COVER    |
 * |  - White bg      |  - Title page    |
 * |  - Storywink     |    illustration  |
 * |    branding      |    (full bleed)  |
 * +------------------+------------------+
 *      8.625"              8.625"
 */
export function generateCoverHtml(
  titlePageImageUrl: string | null | undefined,
  bookTitle: string,
  fontFace: string
): string {
  const containerStyle = `
    width: ${COVER_WIDTH_IN}in;
    height: ${COVER_HEIGHT_IN}in;
    display: flex;
    flex-direction: row;
    margin: 0;
    padding: 0;
  `;

  const backCoverStyle = `
    width: ${PANEL_WIDTH_IN}in;
    height: ${COVER_HEIGHT_IN}in;
    background-color: white;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    box-sizing: border-box;
  `;

  const frontCoverStyle = `
    width: ${PANEL_WIDTH_IN}in;
    height: ${COVER_HEIGHT_IN}in;
    overflow: hidden;
  `;

  const imageStyle = `
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center center;
  `;

  const brandingStyle = `
    font-family: 'Excalifont', cursive, sans-serif;
    font-size: 48px;
    color: #1a1a1a;
    text-align: center;
    font-weight: bold;
  `;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${escapeHtml(bookTitle)} - Cover</title>
      <style>
        ${fontFace}
        /* Page size handled by Puppeteer pdf() options - single source of truth */
        html, body {
          margin: 0;
          padding: 0;
          width: ${COVER_WIDTH_IN}in;
          height: ${COVER_HEIGHT_IN}in;
          overflow: hidden;
        }
        /* Prevent page breaks - both legacy and modern properties */
        * {
          page-break-inside: avoid;
          page-break-before: avoid;
          page-break-after: avoid;
          break-inside: avoid;
          break-before: avoid;
          break-after: avoid;
        }
        .cover-spread {
          display: flex;
          width: ${COVER_WIDTH_IN}in;
          height: ${COVER_HEIGHT_IN}in;
          page-break-inside: avoid;
          break-inside: avoid;
        }
      </style>
    </head>
    <body>
      <div class="cover-spread" style="${containerStyle}">
        <!-- Back Cover (Left Side) -->
        <div style="${backCoverStyle}">
          <!-- Branding: centered -->
          <div style="${brandingStyle}">
            <span>Storywin</span><span style="color: ${CORAL_COLOR};">k.ai</span>
          </div>
          <!-- Mascot: centered below text -->
          <img
            src="${BACK_COVER_MASCOT_URL}"
            alt="Storywink mascot"
            style="
              margin-top: 0.4in;
              height: 12%;
              width: auto;
              object-fit: contain;
            "
          />
        </div>

        <!-- Front Cover (Right Side) -->
        <div style="${frontCoverStyle}">
          ${
            titlePageImageUrl
              ? `<img src="${optimizeForPrint(titlePageImageUrl)}" alt="Front Cover" style="${imageStyle}" />`
              : `<div style="display:flex; align-items:center; justify-content:center; height:100%; background-color:#f0f0f0;">
                <span style="font-size: 48px; color: #666;">Cover image not available</span>
               </div>`
          }
        </div>
      </div>
    </body>
    </html>
  `;
}
