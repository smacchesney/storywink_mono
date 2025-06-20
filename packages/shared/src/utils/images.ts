/**
 * Image utility functions
 */

/**
 * Applies a cooler color temperature to Cloudinary image URLs
 * Reduces yellow cast in generated images by applying -20 temperature adjustment
 */
export function coolifyImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  return url.replace('/upload/', '/upload/e_temperature:-20/');
}