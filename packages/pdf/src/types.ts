import type { Book, Page } from '@storywink/database';

/** Book with its pages, the input every generator expects. */
export type BookWithPages = Book & { pages: Page[] };

export type { Page };

/**
 * Fonts embedded into the PDF HTML as base64.
 *
 * Each app loads these from its own runtime-specific location (web reads
 * `public/fonts` via `process.cwd()`; workers read `assets/fonts` relative to
 * the compiled file). The package stays runtime-agnostic by receiving the
 * bytes rather than reaching into a filesystem it can't predict.
 *
 * The MIME/format written into the `@font-face` `src` is derived from
 * `excalifontFormat` so a `.woff2` (web) and a `.ttf` (workers) both render.
 */
export interface PdfFonts {
  /** Base64-encoded Excalifont (branding / decorative text). */
  excalifontBase64: string;
  /** Font container format for Excalifont, controls the `@font-face` src. */
  excalifontFormat: 'woff2' | 'truetype';
  /** Base64-encoded Andika (English story body text). */
  andikaBase64: string;
  /** Base64-encoded Zen Maru Gothic (Japanese text). */
  zenMaruGothicBase64: string;
}

/**
 * Minimal structured logger the generators call. Compatible with pino's
 * `(obj, msg)` signature (web) and trivially satisfiable by a console shim
 * (workers). Defaults to a console-backed shim when omitted.
 */
export interface PdfLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

/** Options controlling interior PDF layout. */
export interface GenerateBookPdfOptions {
  /** Fonts to embed (required — supplied by the consuming runtime). */
  fonts: PdfFonts;
  /** Include title page illustration as first page (user PDF only). */
  titlePage?: Page;
  /** Append back cover as last page (user PDF only). */
  includeBackCover?: boolean;
  /** Pad to multiple of 4 for Lulu saddle stitch (default: true). */
  padToFour?: boolean;
  /** Optional structured logger (defaults to a console shim). */
  logger?: PdfLogger;
}

/** Options controlling cover PDF generation. */
export interface GenerateLuluCoverOptions {
  /** Fonts to embed (only Excalifont is used for the cover). */
  fonts: Pick<PdfFonts, 'excalifontBase64' | 'excalifontFormat'>;
  /** Optional structured logger (defaults to a console shim). */
  logger?: PdfLogger;
}
