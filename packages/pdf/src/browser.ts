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
  /**
   * Timeout for page operations (navigation, `page.pdf()`) in milliseconds.
   * Default 120_000 — puppeteer's 30s default regularly 500s big books on
   * cold Cloudinary caches. Note: the image-load `page.evaluate` below is
   * governed by the CDP `protocolTimeout` (set to this + 60s), not by
   * `page.setDefaultTimeout`.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Launches a headless browser, renders the given HTML, and returns a PDF buffer.
 *
 * Browser selection is identical across runtimes: prefer the system Chromium
 * pointed at by `PUPPETEER_EXECUTABLE_PATH` (set in the workers Docker image),
 * otherwise fall back to `@sparticuz/chromium` (serverless / web). Puppeteer's
 * `pdf()` dimensions are the single source of truth for page size.
 */
export async function renderPdf(params: RenderPdfParams): Promise<Buffer> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (await chromium.executablePath());

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    executablePath,
    headless: true,
    // CDP-level ceiling; must outlive the page-level timeout or long renders
    // die on the 180s protocol default instead of the configured limit.
    protocolTimeout: timeoutMs + 60_000,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);

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
        }),
      );
    });

    const pdfUint8Array = await page.pdf({
      width: params.pdfWidthIn,
      height: params.pdfHeightIn,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: false, // Puppeteer dimensions take precedence.
      timeout: timeoutMs,
    });

    return Buffer.from(pdfUint8Array);
  } finally {
    await browser.close();
  }
}

export { puppeteer, chromium };
