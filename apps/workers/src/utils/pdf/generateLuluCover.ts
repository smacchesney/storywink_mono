/**
 * Generates cover PDF for Lulu print-on-demand.
 *
 * Creates a cover spread: Back Cover (coral branding) + Front Cover (title page).
 * Specifications: 17.25"x8.75" (back + front, no spine for saddle stitch).
 */

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { Book, Page } from '@storywink/database';

/**
 * Optimizes Cloudinary image URL for print quality.
 * Uses q_auto:best for higher quality compression suitable for print.
 */
function optimizeForPrint(url: string | null | undefined): string {
  if (!url) return '';
  if (!url.includes('/image/upload/')) return url;
  return url.replace('/upload/', '/upload/f_auto,q_auto:best/');
}

// Define the expected input type (Book with Pages)
type BookWithPages = Book & { pages: Page[] };

// Lulu 8.5x8.5 Cover Spread Specifications (Saddle Stitch - No Spine)
// Cover spread = Back Cover + Front Cover side by side
const DPI = 300;

// Full spread dimensions (Back + Front)
const COVER_WIDTH_IN = 17.25; // 8.625" x 2
const COVER_HEIGHT_IN = 8.75;

const COVER_WIDTH_PX = Math.round(COVER_WIDTH_IN * DPI); // 5175px
const COVER_HEIGHT_PX = Math.round(COVER_HEIGHT_IN * DPI); // 2625px

// Single panel dimensions (in inches for PDF rendering)
const PANEL_WIDTH_IN = COVER_WIDTH_IN / 2; // 8.625"

// Brand colors
const CORAL_COLOR = '#F76C5E';

// Back cover mascot
const BACK_COVER_MASCOT_URL = 'https://res.cloudinary.com/storywink/image/upload/v1772291378/Screenshot_2026-02-28_at_10.57.29_PM_qwoqr0.png';

/**
 * Generates the HTML for the Lulu cover spread.
 *
 * Layout (saddle stitch - no spine):
 * +------------------+------------------+
 * |   BACK COVER     |   FRONT COVER    |
 * |                  |                  |
 * |  - Coral bg      |  - Title page    |
 * |    (#F76C5E)     |    illustration  |
 * |                  |    (ALREADY HAS  |
 * |  - Storywink     |     TITLE from   |
 * |    branding      |     AI gen)      |
 * +------------------+------------------+
 *      8.625"              8.625"
 */
function generateCoverHtml(titlePageImageUrl: string | null, bookTitle: string): string {
  // Use inches for all dimensions to match PDF page size exactly
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
    background-color: ${CORAL_COLOR};
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    padding-bottom: 0.5in;
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
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 48px;
    color: white;
    text-align: center;
  `;

  const logoTextStyle = `
    font-weight: 600;
  `;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${bookTitle} - Cover</title>
      <style>
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
          <!-- Mascot: small, bottom-right corner -->
          <img
            src="${BACK_COVER_MASCOT_URL}"
            alt="Storywink mascot"
            style="
              position: absolute;
              bottom: 0.6in;
              right: 0.4in;
              height: 12%;
              width: auto;
              object-fit: contain;
            "
          />
          <div style="${brandingStyle}">
            <span style="${logoTextStyle}">Storywink</span><span style="color: #fff;">.ai</span>
          </div>
        </div>

        <!-- Front Cover (Right Side) -->
        <div style="${frontCoverStyle}">
          ${titlePageImageUrl
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

/**
 * Generates a cover PDF buffer for Lulu print-on-demand.
 * Creates a spread with back cover (coral branding) and front cover (title page illustration).
 *
 * @param bookData - Book with pages array
 * @returns PDF buffer for the cover spread
 */
export async function generateLuluCover(bookData: BookWithPages): Promise<Buffer> {
  console.log(`[PDF] Starting cover PDF generation for book ${bookData.id}...`);
  let browser = null;

  try {
    // Find the title page (cover page) - it's the page where assetId matches book.coverAssetId
    const titlePage = bookData.pages.find(page => page.assetId === bookData.coverAssetId);

    if (!titlePage) {
      console.warn(`[PDF] No title page found for book ${bookData.id}, using first page as cover`);
    }

    const coverImageUrl = titlePage?.generatedImageUrl || bookData.pages[0]?.generatedImageUrl;

    // Generate HTML
    const coverHtml = generateCoverHtml(coverImageUrl, bookData.title || 'My Storybook');

    // Launch Puppeteer
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || await chromium.executablePath();

    console.log(`[PDF] Launching browser at ${executablePath}...`);

    browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();

    // Set viewport FIRST (before content) for correct layout calculation
    await page.setViewport({
      width: COVER_WIDTH_PX,
      height: COVER_HEIGHT_PX,
      deviceScaleFactor: 1,
    });

    // Set content and wait for network to settle
    await page.setContent(coverHtml, { waitUntil: 'networkidle0' });

    // Explicitly wait for all images to load (networkidle0 may fire before Cloudinary images finish)
    await page.evaluate(async () => {
      const images = Array.from(document.querySelectorAll('img'));
      await Promise.all(
        images.map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });
        })
      );
    });

    // Generate PDF with Puppeteer as single source of truth for dimensions
    console.log(`[PDF] Generating cover PDF buffer...`);
    const pdfUint8Array = await page.pdf({
      width: `${COVER_WIDTH_IN}in`,
      height: `${COVER_HEIGHT_IN}in`,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: false,  // Puppeteer dimensions take precedence
    });

    const pdfBuffer = Buffer.from(pdfUint8Array);
    console.log(`[PDF] Cover PDF generated: ${pdfBuffer.length} bytes`);

    return pdfBuffer;

  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[PDF] Error generating cover PDF for book ${bookData.id}:`, err.message);
    throw new Error(`Failed to generate cover PDF: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[PDF] Browser closed for book ${bookData.id}`);
    }
  }
}
