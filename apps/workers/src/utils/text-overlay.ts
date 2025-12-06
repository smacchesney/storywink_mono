import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import opentype from 'opentype.js';

// ----------------------------------
// TYPES
// ----------------------------------

export interface TextOverlayOptions {
  fontSize?: number;
  color?: string;
  yPosition?: number; // 0-1, percentage from top
  lineHeight?: number; // multiplier for line spacing
  maxWidth?: number; // 0-1, percentage of image width
  maxLines?: number;
}

const DEFAULT_OPTIONS: Required<TextOverlayOptions> = {
  fontSize: 50, // Smaller for more text capacity (was 80px)
  color: '#1a1a1a',
  yPosition: 0.88, // 88% from top (centered in bottom 18%)
  lineHeight: 1.3,
  maxWidth: 0.90,
  maxLines: 3,
};

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
// TEXT MEASUREMENT & WRAPPING
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

/**
 * Wrap text to fit within a maximum width using actual font measurements
 */
function wrapTextWithFont(
  font: opentype.Font,
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = measureTextWidth(font, testLine, fontSize);

    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;

      // Check if we've hit max lines
      if (lines.length >= maxLines - 1) {
        // Add remaining words to last line with ellipsis if needed
        const remaining = words.slice(i).join(' ');
        const remainingWidth = measureTextWidth(font, remaining, fontSize);

        if (remainingWidth > maxWidth) {
          // Truncate with ellipsis
          let truncated = '';
          for (let j = i; j < words.length; j++) {
            const test = truncated ? `${truncated} ${words[j]}` : words[j];
            if (measureTextWidth(font, test + '...', fontSize) <= maxWidth) {
              truncated = test;
            } else {
              break;
            }
          }
          currentLine = truncated ? truncated + '...' : word.substring(0, 10) + '...';
        } else {
          currentLine = remaining;
        }
        break;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Calculate appropriate font size based on text length
 */
function calculateFontSize(
  font: opentype.Font,
  text: string,
  baseFontSize: number,
  maxWidth: number,
  maxLines: number
): number {
  // Start with base font size and reduce if needed
  let fontSize = baseFontSize;
  const minFontSize = baseFontSize * 0.65;

  while (fontSize >= minFontSize) {
    const lines = wrapTextWithFont(font, text, maxWidth, fontSize, maxLines);
    if (lines.length <= maxLines) {
      return fontSize;
    }
    fontSize -= 2;
  }

  return minFontSize;
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
// GRADIENT FADE (Fallback for missing white space)
// ----------------------------------

/**
 * Apply a white gradient fade to the bottom of the image
 * This is a fallback for when Gemini doesn't leave proper white space
 * When Gemini does leave white space, this is invisible (white on white)
 */
async function applyGradientFade(
  imageBuffer: Buffer,
  width: number,
  height: number
): Promise<Buffer> {
  // Gradient covers bottom 22% of image
  // Starts transparent at 78%, fully white by ~90%
  const gradientStartY = Math.round(height * 0.78);
  const gradientHeight = height - gradientStartY;

  const gradientSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fadeGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="white" stop-opacity="0"/>
        <stop offset="55%" stop-color="white" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="white" stop-opacity="1"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${gradientStartY}" width="${width}" height="${gradientHeight}" fill="url(#fadeGradient)"/>
  </svg>`;

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(gradientSvg), top: 0, left: 0 }])
    .toBuffer();
}

// ----------------------------------
// MAIN FUNCTION
// ----------------------------------

/**
 * Add text overlay to an image buffer
 * Text is rendered in the bottom portion of the image (white space area)
 * Uses opentype.js to convert text to SVG paths - no fontconfig dependency
 *
 * Applies a gradient fade fallback first to ensure text readability
 * even when Gemini doesn't leave proper white space at bottom
 */
export async function addTextToImage(
  imageBuffer: Buffer,
  text: string,
  options: TextOverlayOptions = {}
): Promise<Buffer> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const font = loadFont();

  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;

  // Apply gradient fade as fallback for missing white space
  // This is invisible when Gemini leaves proper white space (white on white)
  const imageWithGradient = await applyGradientFade(imageBuffer, width, height);

  // Calculate max width for text in pixels
  const maxTextWidth = width * opts.maxWidth;

  // Calculate font size based on text length (using actual font metrics)
  const fontSize = calculateFontSize(font, text, opts.fontSize, maxTextWidth, opts.maxLines);

  // Wrap text into lines (using actual font metrics)
  const lines = wrapTextWithFont(font, text, maxTextWidth, fontSize, opts.maxLines);

  // Calculate vertical positioning
  const lineSpacing = fontSize * opts.lineHeight;
  const textBlockHeight = lines.length * lineSpacing;
  const bottomAreaStart = height * 0.82; // Where illustration ends
  const bottomAreaHeight = height * 0.18; // White space area
  const startY = bottomAreaStart + (bottomAreaHeight - textBlockHeight) / 2 + fontSize;

  // Generate SVG paths for each line (centered)
  const pathElements = lines.map((line, i) => {
    const lineWidth = measureTextWidth(font, line, fontSize);
    const x = (width - lineWidth) / 2; // Center horizontally
    const y = startY + (i * lineSpacing);
    const pathData = textToSvgPath(font, line, x, y, fontSize);
    return `<path d="${pathData}" fill="${opts.color}"/>`;
  }).join('\n    ');

  // Create SVG with path elements (no text elements = no fontconfig needed)
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${pathElements}
  </svg>`;

  // Composite SVG onto image (with gradient already applied)
  return sharp(imageWithGradient)
    .composite([{
      input: Buffer.from(svg),
      top: 0,
      left: 0,
    }])
    .toBuffer();
}

/**
 * Check if the text overlay module is properly initialized
 */
export function isTextOverlayReady(): boolean {
  try {
    loadFont();
    return true;
  } catch {
    return false;
  }
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
