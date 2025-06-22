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
 * Applies professional color correction to Cloudinary image URLs using LUT
 * Only applies to generated images with standard Cloudinary upload URLs
 * Uses storywink-LUT.cube for consistent color grading
 */
export function coolifyImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  
  // Only transform Cloudinary URLs with /image/upload/ pattern
  if (!url.includes('/image/upload/')) {
    return url; // Return unchanged if not a standard Cloudinary upload URL
  }
  
  return url.replace('/image/upload/', '/image/upload/l_lut:storywink-LUT.cube/');
}