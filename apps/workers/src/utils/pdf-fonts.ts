import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { PdfFonts } from '@storywink/pdf';

/**
 * Loads the fonts embedded into generated PDFs from the workers app's
 * `assets/fonts` directory.
 *
 * The unified `@storywink/pdf` package is runtime-agnostic and receives font
 * bytes rather than reading the filesystem itself. The web app has its own
 * loader reading from `public/fonts`.
 *
 * Path resolution mirrors the proven pattern in `image-processing.ts` (the
 * text-overlay loader that runs on the illustration path): resolve relative to
 * this module's directory, then `../assets/fonts`. In the esbuild ESM bundle
 * (`dist/index.js`) this resolves to `apps/workers/assets/fonts`.
 *
 * NOTE: the pre-unification workers PDF loader used `../../assets/fonts`
 * (two levels up), which resolved to a non-existent path in the bundle and
 * silently fell back to Chromium's default fonts. This loader corrects that so
 * the Lulu print PDFs render with the intended fonts (Excalifont / Andika /
 * Zen Maru Gothic) — verify against a Lulu proof print.
 */
export function loadWorkerPdfFonts(): PdfFonts {
  return {
    excalifontBase64: loadFont('Excalifont.ttf'),
    excalifontFormat: 'truetype',
    andikaBase64: loadFont('Andika-Regular.ttf'),
    zenMaruGothicBase64: loadFont('ZenMaruGothic-Regular.ttf'),
  };
}

function loadFont(fileName: string): string {
  try {
    const currentDir =
      typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
    const fontPath = join(currentDir, '../assets/fonts', fileName);
    return readFileSync(fontPath).toString('base64');
  } catch {
    console.warn(`[PDF] Could not load ${fileName} for PDF embedding`);
    return '';
  }
}
