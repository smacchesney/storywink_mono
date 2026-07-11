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
 * Categorizes pages into story pages and cover pages.
 * storyPages includes ALL pages (cover photo participates in the story).
 * coverPages identifies which page(s) provide the cover illustration.
 */
export function categorizePages<T extends { assetId: string | null }>(
  pages: T[],
  bookCoverAssetId: string | null
): { storyPages: T[]; coverPages: T[] } {
  const coverPages = pages.filter(page => isTitlePage(page.assetId, bookCoverAssetId));

  return { storyPages: pages, coverPages };
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
 * Optimizes a Cloudinary URL for AI vision model input.
 * Caps images at 2048px (OpenAI's max before auto-downscale) with quality optimization.
 * Reduces bandwidth without quality loss for vision API calls.
 */
export function optimizeCloudinaryUrlForVision(url: string): string {
  if (!url || !url.includes('/upload/')) return url;
  return url.replace('/upload/', '/upload/c_limit,w_2048,h_2048,q_auto/');
}

/**
 * Converts HEIC images to JPEG format using Cloudinary transformation
 * Vision APIs only support: png, jpeg, gif, webp (NOT heic)
 * This function automatically converts HEIC to JPEG for AI model compatibility
 *
 * Note: First-time HEIC conversions may be slow. Consider:
 * 1. Using eager transformations in Cloudinary upload preset
 * 2. Blocking HEIC uploads in favor of JPEG/PNG
 * 3. Pre-converting HEIC files on the client before upload
 */
export function convertHeicToJpeg(url: string | null | undefined): string {
  if (!url) return '';

  // Check for HEIC/HEIF extension (case insensitive). iPhones shoot both
  // container types; both are unrenderable by browsers and vision APIs.
  const lower = url.toLowerCase();
  const isHeic = lower.includes('.heic') || lower.includes('.heif');

  if (isHeic) {
    // Cloudinary transformation: f_jpg,fl_force_strip converts HEIC/HEIF to JPEG
    // fl_force_strip removes all metadata to speed up conversion
    return url.replace('/upload/', '/upload/f_jpg,fl_force_strip/');
  }

  return url;
}

/**
 * Optimizes Cloudinary image URLs by adding automatic format and quality transformations.
 *
 * Applies `f_auto,q_auto` which:
 * - f_auto: Automatically delivers WebP, AVIF, or JPEG based on browser support
 * - q_auto: Automatically adjusts quality for optimal file size/quality balance
 *
 * Expected file size reduction: 30-60%
 *
 * @param url - Cloudinary image URL (or null/undefined)
 * @param options - Optional configuration
 * @returns Optimized URL or empty string if input is falsy
 */
export function optimizeCloudinaryUrl(
  url: string | null | undefined,
  options?: {
    /** Skip optimization (useful when you need the original) */
    skipOptimization?: boolean;
    /** Additional transformations to prepend (e.g., 'c_fill,w_200,h_200') */
    additionalTransforms?: string;
  }
): string {
  if (!url) return '';
  if (options?.skipOptimization) return url;

  // Only process Cloudinary URLs with /image/upload/ pattern
  // This excludes user-uploaded photos (which may use /video/upload/ for raw storage)
  // and non-Cloudinary URLs
  if (!url.includes('/image/upload/')) {
    return url;
  }

  const baseTransform = 'f_auto,q_auto';
  const transforms = options?.additionalTransforms
    ? `${options.additionalTransforms},${baseTransform}`
    : baseTransform;

  return url.replace('/upload/', `/upload/${transforms}/`);
}

/**
 * Alias for optimizeCloudinaryUrl for backward compatibility
 * @deprecated Use optimizeCloudinaryUrl instead
 */
export const coolifyImageUrl = optimizeCloudinaryUrl;

/**
 * Calculates the actual printed interior page count for a book.
 *
 * Interior layout (saddle stitch):
 *   Page 1: Dedication
 *   Pages 2..2N+1: [Text page + Illustration page] × N photos
 *   Page 2N+2: Ending ("The End")
 *
 * All photos (including the cover photo) appear in the interior.
 *
 * @param totalDbPages - Total page rows in the database
 * @param options.padToMultipleOf4 - Pad to multiple of 4 for Lulu saddle stitch (default false)
 * @param options.collagePages - Real-moments collage pages appended after the ending (default 0)
 * @returns The number of printed interior pages
 */
export function calculatePrintedPageCount(
  totalDbPages: number,
  options?: { padToMultipleOf4?: boolean; collagePages?: number }
): number {
  const storyPhotos = Math.max(0, totalDbPages); // all photos are story pages
  const rawCount =
    2 + storyPhotos * 2 + Math.max(0, options?.collagePages ?? 0); // dedication + ending + pairs + collage

  if (options?.padToMultipleOf4) {
    return Math.ceil(rawCount / 4) * 4;
  }

  return rawCount;
}
/**
 * Remaps a perception-pass CharacterIdentity's appearsOnPages from
 * creation-order photo numbers to the CURRENT page order.
 *
 * appearsOnPages is positional: the perception pass numbers photos 1..N in
 * the order they existed at analysis time. When the parent reorders photos,
 * those numbers silently point at the wrong pages. The perception pass also
 * stamps appearsOnAssetIds (the assetId behind each number), which lets us
 * recover the correct current positions here.
 *
 * Returns null when remapping is impossible (no appearsOnAssetIds stamps, or
 * an asset no longer exists on the book) — callers must treat null as
 * "identity page-mapping is unusable" and degrade (re-extract, or omit
 * page-targeted character instructions) rather than trust stale numbers.
 */
export function remapCharacterPages<
  T extends {
    characters: {
      appearsOnPages: number[];
      appearsOnAssetIds?: (string | null)[];
    }[];
  },
>(identity: T, currentOrderedAssetIds: (string | null)[]): T | null {
  const positionByAsset = new Map<string, number>();
  currentOrderedAssetIds.forEach((assetId, index) => {
    if (assetId) positionByAsset.set(assetId, index + 1);
  });

  const remappedCharacters = [];
  for (const character of identity.characters) {
    const assetIds = character.appearsOnAssetIds;
    if (!assetIds) return null; // legacy identity without stamps — cannot remap

    const pages: number[] = [];
    for (const assetId of assetIds) {
      if (!assetId) continue;
      const position = positionByAsset.get(assetId);
      if (position === undefined) return null; // photo removed/replaced — stale
      pages.push(position);
    }
    remappedCharacters.push({
      ...character,
      appearsOnPages: [...new Set(pages)].sort((a, b) => a - b),
    });
  }

  return { ...identity, characters: remappedCharacters };
}
