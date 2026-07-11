/**
 * Lulu 8.5x8.5 print specifications, shared by interior and cover generators.
 * See packages/shared/src/lulu.ts for full spec documentation.
 */
export const DPI = 300;

// Interior page (trim + bleed)
export const PAGE_WIDTH_IN = 8.5; // Lulu trim width
export const PAGE_HEIGHT_IN = 8.5; // Lulu trim height
export const BLEED_MARGIN_IN = 0.125; // Lulu bleed margin

export const PAGE_WIDTH_WITH_BLEED_IN = PAGE_WIDTH_IN + 2 * BLEED_MARGIN_IN; // 8.75"
export const PAGE_HEIGHT_WITH_BLEED_IN = PAGE_HEIGHT_IN + 2 * BLEED_MARGIN_IN; // 8.75"

export const PAGE_WIDTH_PX = Math.round(PAGE_WIDTH_WITH_BLEED_IN * DPI); // 2625px
export const PAGE_HEIGHT_PX = Math.round(PAGE_HEIGHT_WITH_BLEED_IN * DPI); // 2625px

// Cover spread (Back Cover + Front Cover, saddle stitch — no spine)
export const COVER_WIDTH_IN = 17.25; // 8.625" x 2
export const COVER_HEIGHT_IN = 8.75;
export const COVER_WIDTH_PX = Math.round(COVER_WIDTH_IN * DPI); // 5175px
export const COVER_HEIGHT_PX = Math.round(COVER_HEIGHT_IN * DPI); // 2625px
export const PANEL_WIDTH_IN = COVER_WIDTH_IN / 2; // 8.625"

// Brand
export const CORAL_COLOR = '#F76C5E';

// Mascots (Cloudinary)
export const DEDICATION_MASCOT_URL =
  'https://res.cloudinary.com/storywink/image/upload/v1772291377/Screenshot_2026-02-28_at_10.58.09_PM_gnknk5.png';
export const ENDING_MASCOT_URL =
  'https://res.cloudinary.com/storywink/image/upload/v1772291378/Screenshot_2026-02-28_at_10.57.54_PM_sxcasb.png';
export const BACK_COVER_MASCOT_URL =
  'https://res.cloudinary.com/storywink/image/upload/v1772291378/Screenshot_2026-02-28_at_10.57.29_PM_qwoqr0.png';

/**
 * Optimizes a Cloudinary image URL for print quality.
 * f_jpg (not f_auto): Chromium embeds JPEG bytes into the PDF verbatim, but
 * losslessly re-encodes WebP/AVIF into huge flate streams. q_auto:best keeps
 * print-grade quality.
 */
export function optimizeForPrint(url: string | null | undefined): string {
  if (!url) return '';
  if (!url.includes('/image/upload/')) return url;
  return url.replace('/upload/', '/upload/f_jpg,q_auto:best/');
}

/** Returns the CSS font-family for story text based on language. */
export function storyFontFamily(language: string): string {
  return language === 'ja'
    ? "'Zen Maru Gothic', 'Hiragino Maru Gothic Pro', sans-serif"
    : "'Andika', sans-serif";
}

/** Returns the CSS font-family for branding/decorative text (dedication, ending). */
export function brandingFontFamily(language: string): string {
  return language === 'ja'
    ? "'Zen Maru Gothic', 'Hiragino Maru Gothic Pro', sans-serif"
    : "'Excalifont', cursive, sans-serif";
}
