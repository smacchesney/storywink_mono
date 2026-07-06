/**
 * Cloudinary-native image delivery for book art.
 *
 * Used as a per-image `loader` on next/image so the browser pulls responsive
 * variants (`w_{width},c_limit,f_auto,q_auto`) straight from Cloudinary's
 * CDN. That takes the Railway-hosted Next optimizer — a second image hop
 * with a cold cache per deploy — out of the hot path for reading a book.
 *
 * Pass the RAW Cloudinary URL as `src` (not one already run through
 * `coolifyImageUrl`), so exactly one transformation segment is inserted.
 * Kept free of React imports so it stays unit-testable.
 */

export interface CloudinaryLoaderParams {
  src: string;
  width: number;
  quality?: number;
}

/** next/image loader: insert one Cloudinary transform for the requested width. */
export function cloudinaryLoader({ src, width, quality }: CloudinaryLoaderParams): string {
  // Only Cloudinary image-delivery URLs get a transform; anything else
  // (placeholders, other hosts) passes through untouched.
  if (!src.includes('/image/upload/')) return src;
  return src.replace('/upload/', `/upload/f_auto,q_${quality ?? 'auto'},w_${width},c_limit/`);
}

/**
 * One tiny derived asset per image (~1 KB) painted as a page background
 * before the real art arrives. The blur itself is CSS (`filter: blur`), so
 * this stays a single extra Cloudinary transformation — not a second
 * derived asset per width variant.
 */
export function tinyThumbUrl(src: string): string {
  if (!src.includes('/image/upload/')) return src;
  return src.replace('/upload/', '/upload/f_auto,q_auto,w_24/');
}
