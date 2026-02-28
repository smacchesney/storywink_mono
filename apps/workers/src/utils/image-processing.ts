import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import opentype from 'opentype.js';

// ----------------------------------
// CONSTANTS
// ----------------------------------

// Target size for Lulu print (8.75" × 8.75" at 300 DPI)
const LULU_PRINT_SIZE_PX = 2625;

// ----------------------------------
// IMAGE UPSCALING FOR PRINT
// ----------------------------------

/**
 * Upscale image to Lulu print dimensions using Sharp.
 * Uses lanczos3 kernel for best quality upscaling.
 *
 * Gemini generates 2K (2048×2048) images, but Lulu requires
 * 2625×2625 pixels for 300 DPI at 8.75" × 8.75" with bleed.
 *
 * @param imageBuffer - Input image buffer (typically 2048×2048 from Gemini)
 * @param targetSize - Target dimension in pixels (default: 2625 for Lulu)
 * @returns Upscaled image buffer
 */
export async function upscaleForPrint(
  imageBuffer: Buffer,
  targetSize: number = LULU_PRINT_SIZE_PX
): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize(targetSize, targetSize, {
      kernel: 'lanczos3',  // Best quality for upscaling
      fit: 'fill',         // Exact dimensions (image is already 1:1)
    })
    .png({ quality: 100 })
    .toBuffer();
}

// ----------------------------------
// FONT LOADING (opentype.js)
// ----------------------------------

let loadedFont: opentype.Font | null = null;

function loadFont(): opentype.Font {
  if (loadedFont) return loadedFont;

  try {
    // Handle both ESM and CommonJS module paths
    const currentDir = typeof __dirname !== 'undefined'
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));

    const fontPath = join(currentDir, '../assets/fonts/Excalifont.ttf');

    // Read font file and convert to proper ArrayBuffer
    // Node.js Buffer from the pool can have non-zero byteOffset, so we must
    // copy into a fresh Uint8Array to guarantee ArrayBuffer starts at offset 0
    const fontBuffer = readFileSync(fontPath);
    const uint8Array = new Uint8Array(fontBuffer);

    // Parse font with opentype.js
    loadedFont = opentype.parse(uint8Array.buffer);
    return loadedFont;
  } catch (error) {
    console.error('Failed to load font file:', error);
    throw new Error('Font file not found. Ensure Excalifont.ttf is in assets/fonts/');
  }
}

// ----------------------------------
// TEXT MEASUREMENT (used by logo overlay)
// ----------------------------------

/**
 * Measure text width using actual font metrics
 */
function measureTextWidth(font: opentype.Font, text: string, fontSize: number): number {
  const scale = fontSize / font.unitsPerEm;
  let width = 0;

  for (let i = 0; i < text.length; i++) {
    const glyph = font.charToGlyph(text[i]);
    width += (glyph.advanceWidth || 0) * scale;
  }

  return width;
}

// ----------------------------------
// SVG PATH GENERATION
// ----------------------------------

/**
 * Convert text to SVG path data using opentype.js
 * This bypasses fontconfig entirely - pure JavaScript font rendering
 */
function textToSvgPath(
  font: opentype.Font,
  text: string,
  x: number,
  y: number,
  fontSize: number
): string {
  const path = font.getPath(text, x, y, fontSize);
  return path.toPathData(2); // 2 decimal places precision
}

// ----------------------------------
// LOGO OVERLAY FOR TITLE PAGES
// ----------------------------------

// Brand colors
const CORAL_COLOR = '#F76C5E';
const DARK_GRAY_COLOR = '#1a1a1a';

/**
 * Add Storywink.ai logo to the bottom-left of a title page image
 * Logo consists of dino mascot + "Storywink.ai" text (with "k.ai" in coral)
 */
export async function addLogoToTitlePage(imageBuffer: Buffer): Promise<Buffer> {
  const font = loadFont();

  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;

  // Logo sizing (responsive to image size)
  const mascotHeight = Math.round(height * 0.06); // 6% of image height
  const fontSize = Math.round(mascotHeight * 0.5); // Font ~50% of mascot height
  const padding = Math.round(width * 0.03); // 3% padding from edges
  const mascotTextGap = Math.round(mascotHeight * 0.15); // Gap between mascot and text

  // Load and resize mascot image
  const currentDir = typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
  const mascotPath = join(currentDir, '../assets/images/mascot.png');

  let mascotBuffer: Buffer;
  try {
    mascotBuffer = await sharp(mascotPath)
      .resize({ height: mascotHeight, withoutEnlargement: false })
      .toBuffer();
  } catch (error) {
    console.error('Failed to load mascot image:', error);
    // Return original image if mascot loading fails
    return imageBuffer;
  }

  const mascotMeta = await sharp(mascotBuffer).metadata();
  const mascotWidth = mascotMeta.width || mascotHeight;

  // Text parts: "Storywin" (dark gray) + "k.ai" (coral)
  const text1 = 'Storywin';
  const text2 = 'k.ai';

  // Measure text widths
  const text1Width = measureTextWidth(font, text1, fontSize);
  const text2Width = measureTextWidth(font, text2, fontSize);

  // Calculate positions
  const textStartX = mascotWidth + mascotTextGap;
  const totalLogoWidth = textStartX + text1Width + text2Width;

  // Position logo in bottom-left corner
  const logoX = padding;
  const logoY = height - padding - mascotHeight;

  // Create SVG for text with two colors
  // Y position for text baseline (vertically centered with mascot)
  const textY = mascotHeight * 0.7; // Baseline position

  // Generate path data for both text parts
  const path1Data = textToSvgPath(font, text1, textStartX, textY, fontSize);
  const path2Data = textToSvgPath(font, text2, textStartX + text1Width, textY, fontSize);

  const textSvg = `<svg width="${totalLogoWidth}" height="${mascotHeight}" xmlns="http://www.w3.org/2000/svg">
    <path d="${path1Data}" fill="${DARK_GRAY_COLOR}"/>
    <path d="${path2Data}" fill="${CORAL_COLOR}"/>
  </svg>`;

  const textBuffer = await sharp(Buffer.from(textSvg))
    .toBuffer();

  // Composite everything onto the original image
  return sharp(imageBuffer)
    .composite([
      // Mascot in bottom-left
      {
        input: mascotBuffer,
        left: logoX,
        top: logoY,
      },
      // Text next to mascot
      {
        input: textBuffer,
        left: logoX,
        top: logoY,
      },
    ])
    .toBuffer();
}
