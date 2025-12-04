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
  fontSize: 42,
  color: '#1a1a1a',
  yPosition: 0.88, // 88% from top (centered in bottom 18%)
  lineHeight: 1.5,
  maxWidth: 0.85,
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

    const fontPath = join(currentDir, '../assets/fonts/LibreBaskerville-Italic.ttf');
    const fontBuffer = readFileSync(fontPath);

    // Parse font with opentype.js
    loadedFont = opentype.parse(fontBuffer.buffer as ArrayBuffer);
    return loadedFont;
  } catch (error) {
    console.error('Failed to load font file:', error);
    throw new Error('Font file not found. Ensure LibreBaskerville-Italic.ttf is in assets/fonts/');
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
// MAIN FUNCTION
// ----------------------------------

/**
 * Add text overlay to an image buffer
 * Text is rendered in the bottom portion of the image (white space area)
 * Uses opentype.js to convert text to SVG paths - no fontconfig dependency
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

  // Composite SVG onto image
  return sharp(imageBuffer)
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
