/**
 * Utility functions shared across the monorepo
 */
/**
 * Determines if a page is a title page based on the book's cover asset
 * This is the canonical logic that should be used everywhere
 */
export function isTitlePage(pageAssetId, bookCoverAssetId) {
    return pageAssetId === bookCoverAssetId && pageAssetId !== null;
}
/**
 * Filters pages into story pages and title pages using consistent logic
 */
export function categorizePages(pages, bookCoverAssetId) {
    const storyPages = pages.filter(page => !isTitlePage(page.assetId, bookCoverAssetId));
    const titlePages = pages.filter(page => isTitlePage(page.assetId, bookCoverAssetId));
    return { storyPages, titlePages };
}
/**
 * Gets the title page from a list of pages
 */
export function getTitlePage(pages, bookCoverAssetId) {
    return pages.find(page => isTitlePage(page.assetId, bookCoverAssetId)) || null;
}
