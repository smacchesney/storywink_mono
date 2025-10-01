/**
 * Utility functions shared across the monorepo
 */

/**
 * Determines if a page is a title page based on the book's cover asset
 * This is the canonical logic that should be used everywhere
 */
export function isTitlePage(pageAssetId: string | null, bookCoverAssetId: string | null): boolean {
  return pageAssetId === bookCoverAssetId && pageAssetId !== null;
}

/**
 * Filters pages into story pages and title pages using consistent logic
 */
export function categorizePages<T extends { assetId: string | null }>(
  pages: T[], 
  bookCoverAssetId: string | null
): { storyPages: T[]; titlePages: T[] } {
  const storyPages = pages.filter(page => !isTitlePage(page.assetId, bookCoverAssetId));
  const titlePages = pages.filter(page => isTitlePage(page.assetId, bookCoverAssetId));
  
  return { storyPages, titlePages };
}

/**
 * Gets the title page from a list of pages
 */
export function getTitlePage<T extends { assetId: string | null }>(
  pages: T[], 
  bookCoverAssetId: string | null
): T | null {
  return pages.find(page => isTitlePage(page.assetId, bookCoverAssetId)) || null;
}

/**
 * Converts HEIC images to JPEG format using Cloudinary transformation
 * OpenAI Vision API only supports: png, jpeg, gif, webp (NOT heic)
 * This function automatically converts HEIC to JPEG for AI model compatibility
 *
 * Note: First-time HEIC conversions may be slow. Consider:
 * 1. Using eager transformations in Cloudinary upload preset
 * 2. Blocking HEIC uploads in favor of JPEG/PNG
 * 3. Pre-converting HEIC files on the client before upload
 */
export function convertHeicToJpeg(url: string | null | undefined): string {
  if (!url) return '';

  // Check if URL contains .heic extension (case insensitive)
  const isHeic = url.toLowerCase().includes('.heic');

  if (isHeic) {
    // Cloudinary transformation: f_jpg,fl_force_strip converts HEIC to JPEG
    // fl_force_strip removes all metadata to speed up conversion
    return url.replace('/upload/', '/upload/f_jpg,fl_force_strip/');
  }

  return url;
}

/**
 * Safely handles image URLs, returning empty string for null/undefined values
 */
export function coolifyImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  return url;
}