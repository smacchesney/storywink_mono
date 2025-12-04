import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ----------------------------------
// TYPES
// ----------------------------------

export interface TextOverlayOptions {
  fontSize?: number;
  color?: string;
  yPosition?: number; // 0-1, percentage from top
  lineHeight?: number; // em units
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
// FONT LOADING
// ----------------------------------

let fontBase64: string | null = null;

function loadFont(): string {
  if (fontBase64) return fontBase64;

  try {
    // Handle both ESM and CommonJS module paths
    const currentDir = typeof __dirname !== 'undefined'
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));

    const fontPath = join(currentDir, '../assets/fonts/LibreBaskerville-Italic.ttf');
    fontBase64 = readFileSync(fontPath).toString('base64');
    return fontBase64;
  } catch (error) {
    console.error('Failed to load font file:', error);
    throw new Error('Font file not found. Ensure LibreBaskerville-Italic.ttf is in assets/fonts/');
  }
}

// ----------------------------------
// TEXT UTILITIES
// ----------------------------------

/**
 * Escape special XML characters for SVG
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Wrap text to fit within a maximum width
 * Uses character count approximation (no actual text measurement in Node)
 */
function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (testLine.length <= maxCharsPerLine) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;

      // Check if we've hit max lines
      if (lines.length >= maxLines - 1) {
        // Add remaining words to last line with ellipsis if needed
        const remaining = words.slice(words.indexOf(word)).join(' ');
        if (remaining.length > maxCharsPerLine) {
          currentLine = remaining.substring(0, maxCharsPerLine - 3) + '...';
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
function calculateFontSize(text: string, baseFontSize: number, maxLines: number): number {
  const charCount = text.length;

  // Approximate characters per line at base font size (for 1024px width at 85%)
  const baseCharsPerLine = 45;
  const estimatedLines = Math.ceil(charCount / baseCharsPerLine);

  if (estimatedLines <= maxLines) {
    return baseFontSize;
  }

  // Reduce font size proportionally for longer text
  const scaleFactor = Math.max(0.7, maxLines / estimatedLines);
  return Math.round(baseFontSize * scaleFactor);
}

// ----------------------------------
// MAIN FUNCTION
// ----------------------------------

/**
 * Add text overlay to an image buffer
 * Text is rendered in the bottom portion of the image (white space area)
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

  // Calculate font size based on text length
  const fontSize = calculateFontSize(text, opts.fontSize, opts.maxLines);

  // Calculate max characters per line (approximate)
  const maxCharsPerLine = Math.floor((width * opts.maxWidth) / (fontSize * 0.5));

  // Wrap text into lines
  const lines = wrapText(text, maxCharsPerLine, opts.maxLines);

  // Calculate vertical position for text block
  // Center the text block in the bottom white space area
  const textBlockHeight = lines.length * fontSize * opts.lineHeight;
  const bottomAreaStart = height * 0.82; // Where illustration ends
  const bottomAreaHeight = height * 0.18; // White space area
  const textY = bottomAreaStart + (bottomAreaHeight - textBlockHeight) / 2 + fontSize;

  // Build tspan elements for each line
  const tspans = lines.map((line, i) => {
    const dy = i === 0 ? 0 : opts.lineHeight;
    return `<tspan x="50%" dy="${dy}em">${escapeXml(line)}</tspan>`;
  }).join('');

  // Create SVG overlay
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          @font-face {
            font-family: 'Libre Baskerville';
            src: url('data:font/truetype;base64,${font}') format('truetype');
            font-style: italic;
          }
        </style>
      </defs>
      <text
        x="50%"
        y="${textY}"
        font-family="Libre Baskerville, Georgia, serif"
        font-style="italic"
        font-size="${fontSize}px"
        fill="${opts.color}"
        text-anchor="middle"
      >${tspans}</text>
    </svg>
  `;

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
