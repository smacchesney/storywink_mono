/**
 * @storywink/pdf — single source of truth for Lulu print-on-demand and user
 * PDF export generation. Consumed by the web export routes and the workers
 * print-fulfillment worker.
 *
 * These functions generate PDFs that meet Lulu's specifications for 8.5"x8.5"
 * saddle-stitched children's books, and the differing user-export layout.
 */

export { generateBookPdf } from './generateBookPdf.js';
export { generateLuluCover } from './generateLuluCover.js';

// Pure page-assembly helpers (browser-free, exported for tests and reuse).
export {
  assembleInteriorPages,
  generateIllustrationPageHtml,
  generateTextPageHtml,
  generateDedicationPageHtml,
  generateEndingPageHtml,
  generateBackCoverPageHtml,
  generateBlankPageHtml,
} from './pages.js';
export type { InteriorPage, InteriorPageKind, AssembleInteriorOptions } from './pages.js';

export { generateCoverHtml, resolveCoverImageUrl } from './cover.js';

export type {
  BookWithPages,
  PdfFonts,
  PdfLogger,
  GenerateBookPdfOptions,
  GenerateLuluCoverOptions,
} from './types.js';
