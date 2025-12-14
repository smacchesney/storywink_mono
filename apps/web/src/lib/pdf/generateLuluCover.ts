import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { Book, Page } from '@storywink/database';
import logger from '../logger';

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

// Single panel dimensions
const PANEL_WIDTH_PX = COVER_WIDTH_PX / 2; // 2587.5px (will be rounded)

// Brand colors
const CORAL_COLOR = '#F76C5E';

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
  const containerStyle = `
    width: ${COVER_WIDTH_PX}px;
    height: ${COVER_HEIGHT_PX}px;
    display: flex;
    flex-direction: row;
    margin: 0;
    padding: 0;
  `;

  const backCoverStyle = `
    width: ${PANEL_WIDTH_PX}px;
    height: ${COVER_HEIGHT_PX}px;
    background-color: ${CORAL_COLOR};
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    padding-bottom: 120px;
    box-sizing: border-box;
  `;

  const frontCoverStyle = `
    width: ${PANEL_WIDTH_PX}px;
    height: ${COVER_HEIGHT_PX}px;
    overflow: hidden;
  `;

  const imageStyle = `
    width: 100%;
    height: 100%;
    object-fit: cover;
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
        body { margin: 0; padding: 0; }
        @page {
          size: ${COVER_WIDTH_IN}in ${COVER_HEIGHT_IN}in;
          margin: 0;
        }
      </style>
    </head>
    <body>
      <div style="${containerStyle}">
        <!-- Back Cover (Left Side) -->
        <div style="${backCoverStyle}">
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
  logger.info({ bookId: bookData.id }, 'Starting Lulu cover PDF generation...');
  let browser = null;

  try {
    // Find the title page (cover page) - it's the page where assetId matches book.coverAssetId
    const titlePage = bookData.pages.find(page => page.assetId === bookData.coverAssetId);

    if (!titlePage) {
      logger.warn({ bookId: bookData.id }, 'No title page found, using first page as cover');
    }

    const coverImageUrl = titlePage?.generatedImageUrl || bookData.pages[0]?.generatedImageUrl;

    // Generate HTML
    const coverHtml = generateCoverHtml(coverImageUrl, bookData.title || 'My Storybook');

    // Launch Puppeteer
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || await chromium.executablePath();

    logger.info({ bookId: bookData.id, executablePath }, 'Launching browser for cover...');

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

    // Set content and wait for images
    await page.setContent(coverHtml, { waitUntil: 'networkidle0' });

    // Set viewport to match pixel dimensions for high-res rendering
    await page.setViewport({
      width: COVER_WIDTH_PX,
      height: COVER_HEIGHT_PX,
      deviceScaleFactor: 1,
    });

    // Generate PDF with dimensions in inches (not pixels) for correct Lulu page size
    logger.info({ bookId: bookData.id }, 'Generating cover PDF buffer...');
    const pdfUint8Array = await page.pdf({
      width: `${COVER_WIDTH_IN}in`,
      height: `${COVER_HEIGHT_IN}in`,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });

    const pdfBuffer = Buffer.from(pdfUint8Array);
    logger.info({ bookId: bookData.id, bufferSize: pdfBuffer.length }, 'Cover PDF buffer generated.');

    return pdfBuffer;

  } catch (error: unknown) {
    const err = error as Error;
    logger.error({
      bookId: bookData.id,
      errorMessage: err.message,
      errorStack: err.stack,
      errorName: err.name
    }, 'Error during cover PDF generation');
    throw new Error(`Failed to generate cover PDF: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
      logger.info({ bookId: bookData.id }, 'Puppeteer browser closed (cover).');
    }
  }
}
