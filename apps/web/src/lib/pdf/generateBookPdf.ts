import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { Book, Page } from '@storywink/database';
import { coolifyImageUrl } from '@storywink/shared';
import logger from '../logger'; // Use relative import

// Define the expected input type (Book with Pages)
type BookWithPages = Book & { pages: Page[] };

// Constants
const DPI = 300;
const PAGE_WIDTH_IN = 6.25; // Trimmed width
const PAGE_HEIGHT_IN = 6.25; // Trimmed height
const BLEED_MARGIN_IN = 0.25;

const PAGE_WIDTH_WITH_BLEED_IN = PAGE_WIDTH_IN + 2 * BLEED_MARGIN_IN;
const PAGE_HEIGHT_WITH_BLEED_IN = PAGE_HEIGHT_IN + 2 * BLEED_MARGIN_IN;

// const PAGE_WIDTH_PX_TRIM = Math.round(PAGE_WIDTH_IN * DPI); // Original, for reference if needed
// const PAGE_HEIGHT_PX_TRIM = Math.round(PAGE_HEIGHT_IN * DPI); // Original, for reference if needed

const PAGE_WIDTH_PX = Math.round(PAGE_WIDTH_WITH_BLEED_IN * DPI); // Full size with bleed
const PAGE_HEIGHT_PX = Math.round(PAGE_HEIGHT_WITH_BLEED_IN * DPI); // Full size with bleed

/**
 * Generates HTML for a single book page.
 * TODO: Refine styling for text overlay, fonts, bleed, etc.
 */
function generatePageHtml(page: Page, _bookTitle: string): string {
  // Basic inline styles for now, move to CSS string later
  const pageStyle = `
    width: ${PAGE_WIDTH_PX}px;
    height: ${PAGE_HEIGHT_PX}px;
    position: relative; /* For text overlay */
    overflow: hidden; /* Ensure content stays within bounds */
    page-break-after: always; /* Create page break */
    background-color: #f0f0f0; /* Placeholder background */
  `;
  const imageStyle = `
    display: block;
    width: 100%; 
    height: 100%; 
    object-fit: cover; /* Cover the area, might crop */
  `;
  // const textStyle = `
  //   position: absolute;
  //   bottom: 5%; /* Position text near bottom */
  //   left: 5%;
  //   right: 5%;
  //   text-align: center;
  //   background-color: rgba(0, 0, 0, 0.5); /* Semi-transparent background */
  //   color: white;
  //   padding: 15px;
  //   font-size: 48px; /* Adjust font size based on DPI/desired look */
  //   font-family: sans-serif; /* TODO: Use actual book font */
  //   border-radius: 10px;
  // `;

  return `
    <div class="page" style="${pageStyle}">
      ${page.generatedImageUrl 
        ? `<img src="${coolifyImageUrl(page.generatedImageUrl)}" alt="Page ${page.pageNumber} Illustration" style="${imageStyle}" />` 
        : '<div style="display:flex; align-items:center; justify-content:center; height:100%;">Image not generated</div>'}
    </div>
  `;
}

/**
 * Generates a PDF buffer for the given book data.
 */
export async function generateBookPdf(bookData: BookWithPages): Promise<Buffer> {
  logger.info({ bookId: bookData.id }, "Starting PDF generation...");
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
          @page { 
            size: ${PAGE_WIDTH_PX}px ${PAGE_HEIGHT_PX}px; 
            margin: 0;
          } 
          /* Add other global styles, @font-face if needed */
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

    logger.info({ bookId: bookData.id, executablePath }, "Launching browser...");

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

    // Set content and wait for images/network to likely settle
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

    // Generate PDF
    logger.info({ bookId: bookData.id }, "Generating PDF buffer...");
    const pdfUint8Array = await page.pdf({
      width: `${PAGE_WIDTH_PX}px`,
      height: `${PAGE_HEIGHT_PX}px`,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });
    // Convert Uint8Array to Buffer
    const pdfBuffer = Buffer.from(pdfUint8Array);
    logger.info({ bookId: bookData.id, bufferSize: pdfBuffer.length }, "PDF buffer generated.");

    return pdfBuffer;

  } catch (error: any) {
    logger.error({
      bookId: bookData.id,
      errorMessage: error.message,
      errorStack: error.stack,
      errorName: error.name
    }, "Error during PDF generation");
    throw new Error(`Failed to generate PDF: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
      logger.info({ bookId: bookData.id }, "Puppeteer browser closed.");
    }
  }
} 