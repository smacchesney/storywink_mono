/**
 * Generates interior PDF for Lulu print-on-demand.
 *
 * Uses Puppeteer to render HTML pages to PDF.
 * Specifications: 8.5"x8.5" with 0.125" bleed (8.75"x8.75" total).
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

// Constants - Lulu 8.5x8.5 Print Specifications
// See: packages/shared/src/lulu.ts for full spec documentation
const DPI = 300;
const PAGE_WIDTH_IN = 8.5; // Lulu trim width
const PAGE_HEIGHT_IN = 8.5; // Lulu trim height
const BLEED_MARGIN_IN = 0.125; // Lulu bleed margin

const PAGE_WIDTH_WITH_BLEED_IN = PAGE_WIDTH_IN + 2 * BLEED_MARGIN_IN; // 8.75"
const PAGE_HEIGHT_WITH_BLEED_IN = PAGE_HEIGHT_IN + 2 * BLEED_MARGIN_IN; // 8.75"

const PAGE_WIDTH_PX = Math.round(PAGE_WIDTH_WITH_BLEED_IN * DPI); // 2625px
const PAGE_HEIGHT_PX = Math.round(PAGE_HEIGHT_WITH_BLEED_IN * DPI); // 2625px

/**
 * Generates HTML for a single book page.
 */
function generatePageHtml(page: Page, _bookTitle: string): string {
  // Use inches for container to match PDF page dimensions exactly
  const pageStyle = `
    width: ${PAGE_WIDTH_WITH_BLEED_IN}in;
    height: ${PAGE_HEIGHT_WITH_BLEED_IN}in;
    position: relative;
    overflow: hidden;
    page-break-after: always;
    background-color: white;
  `;
  const imageStyle = `
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center center;
  `;

  return `
    <div class="page" style="${pageStyle}">
      ${page.generatedImageUrl
        ? `<img src="${optimizeForPrint(page.generatedImageUrl)}" alt="Page ${page.pageNumber} Illustration" style="${imageStyle}" />`
        : '<div style="display:flex; align-items:center; justify-content:center; height:100%;">Image not generated</div>'}
    </div>
  `;
}

/**
 * Generates a PDF buffer for the given book data.
 */
export async function generateBookPdf(bookData: BookWithPages): Promise<Buffer> {
  console.log(`[PDF] Starting interior PDF generation for book ${bookData.id}...`);
  let browser = null;

  try {
    // Generate HTML content for all pages
    let fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${bookData.title || 'My Storybook'}</title>
        <style>
          body { margin: 0; padding: 0; }
          /* Page size handled by Puppeteer pdf() options - single source of truth */
        </style>
      </head>
      <body>
    `;
    // Sort pages just in case they aren't ordered
    const sortedPages = [...bookData.pages].sort((a, b) => a.pageNumber - b.pageNumber);
    sortedPages.forEach(page => {
      fullHtml += generatePageHtml(page, bookData.title || 'Untitled');
    });
    fullHtml += `
      </body>
      </html>
    `;

    // Launch Puppeteer - use system Chromium if available (via env var), otherwise @sparticuz/chromium
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
      width: PAGE_WIDTH_PX,
      height: PAGE_HEIGHT_PX,
      deviceScaleFactor: 1,
    });

    // Set content and wait for network to settle
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

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
    console.log(`[PDF] Generating interior PDF buffer...`);
    const pdfUint8Array = await page.pdf({
      width: `${PAGE_WIDTH_WITH_BLEED_IN}in`,
      height: `${PAGE_HEIGHT_WITH_BLEED_IN}in`,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: false,  // Puppeteer dimensions take precedence
    });
    // Convert Uint8Array to Buffer
    const pdfBuffer = Buffer.from(pdfUint8Array);
    console.log(`[PDF] Interior PDF generated: ${pdfBuffer.length} bytes`);

    return pdfBuffer;

  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[PDF] Error generating interior PDF for book ${bookData.id}:`, err.message);
    throw new Error(`Failed to generate interior PDF: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[PDF] Browser closed for book ${bookData.id}`);
    }
  }
}
