import { readFileSync } from 'fs';
import { join } from 'path';
import logger from '@/lib/logger';
import type { PdfFonts } from '@storywink/pdf';

/**
 * Loads the fonts embedded into generated PDFs from the web app's
 * `public/fonts` directory (resolved via `process.cwd()`, which is the Next.js
 * app root at runtime).
 *
 * The unified `@storywink/pdf` package is runtime-agnostic and receives font
 * bytes rather than reading the filesystem itself. The workers app has its own
 * loader reading `.ttf` files from `assets/fonts`. Excalifont is served as
 * `.woff2` here (matching the pre-unification web behaviour).
 */
export function loadWebPdfFonts(): PdfFonts {
  return {
    excalifontBase64: loadFont('Excalifont-Regular.woff2'),
    excalifontFormat: 'woff2',
    andikaBase64: loadFont('Andika-Regular.ttf'),
    zenMaruGothicBase64: loadFont('ZenMaruGothic-Regular.ttf'),
  };
}

function loadFont(fileName: string): string {
  try {
    const fontPath = join(process.cwd(), 'public/fonts', fileName);
    return readFileSync(fontPath).toString('base64');
  } catch {
    logger.warn(`Could not load ${fileName} for PDF embedding`);
    return '';
  }
}
