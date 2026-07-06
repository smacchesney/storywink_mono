import sharp from 'sharp';
import type { IllustrationImageInput } from './illustrators/index.js';

/**
 * Fetches an image URL into the {buffer, mimeType} shape the illustration
 * providers consume. Mime falls back by extension, then to image/jpeg —
 * the same heuristic the illustration worker uses for content images.
 */
export async function fetchImageInput(url: string): Promise<IllustrationImageInput> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }
  const contentTypeHeader = response.headers.get('content-type');
  const mimeType = contentTypeHeader?.startsWith('image/')
    ? contentTypeHeader
    : url.endsWith('.png')
      ? 'image/png'
      : 'image/jpeg';
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

/**
 * Downscales a render to a reference-sized JPEG (default 1024px) before it
 * rides along as an extra provider input. Full print-size buffers (2625px
 * PNG) would bloat the inline request payload for no reference benefit.
 */
export async function resizeForReference(
  buffer: Buffer,
  maxDimension = 1024,
): Promise<IllustrationImageInput> {
  const resized = await sharp(buffer)
    .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { buffer: resized, mimeType: 'image/jpeg' };
}
