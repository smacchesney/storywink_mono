/**
 * Image utility functions
 */

/**
 * Applies a cooler color temperature to Cloudinary image URLs
 * Reduces yellow cast in generated images by applying temperature adjustment
 * Currently set to -100 for testing (extreme blue tint)
 */
export function coolifyImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  return url.replace('/upload/', '/upload/e_temperature:-100/');
}