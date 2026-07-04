import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export interface RenderPdfParams {
  /** Full HTML document to render. */
  html: string;
  /** Viewport width in pixels (for layout calculation). */
  viewportWidthPx: number;
  /** Viewport height in pixels. */
  viewportHeightPx: number;
  /** Final PDF page width, e.g. "8.75in". */
  pdfWidthIn: string;
  /** Final PDF page height, e.g. "8.75in". */
  pdfHeightIn: string;
}

/**
 * Launches a headless browser, renders the given HTML, and returns a PDF buffer.
 *
 * Browser selection is identical across runtimes: prefer the system Chromium
 * pointed at by `PUPPETEER_EXECUTABLE_PATH` (set in the workers Docker image),
 * otherwise fall back to `@sparticuz/chromium` (serverless / web). Puppeteer's
 * `pdf()` dimensions are the single source of truth for page size.
 */
export async function renderPdf(params: RenderPdfParams): Promise<Buffer> {
  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH || (await chromium.executablePath());

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    executablePath,
    headless: true,
  });

  try {
    const page = await browser.newPage();

    // Set viewport FIRST (before content) for correct layout calculation.
    await page.setViewport({
      width: params.viewportWidthPx,
      height: params.viewportHeightPx,
      deviceScaleFactor: 1,
    });

    // Set content and wait for network to settle.
    await page.setContent(params.html, { waitUntil: 'networkidle0' });

    // Explicitly wait for all images to load (networkidle0 may fire before
    // Cloudinary images finish downloading).
    await page.evaluate(async () => {
      const images = Array.from(document.querySelectorAll('img'));
      await Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });
        })
      );
    });

    const pdfUint8Array = await page.pdf({
      width: params.pdfWidthIn,
      height: params.pdfHeightIn,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: false, // Puppeteer dimensions take precedence.
    });

    return Buffer.from(pdfUint8Array);
  } finally {
    await browser.close();
  }
}

export { puppeteer, chromium };
