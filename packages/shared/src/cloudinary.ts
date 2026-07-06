/**
 * Pure helpers for the photo-deletion pipeline (privacy/APPI/GDPR).
 *
 * Everything in this module is side-effect free — no Cloudinary SDK, no
 * Prisma — so both the web routes (collect + enqueue) and the asset-cleanup
 * worker (delete) share one tested implementation of the fiddly parts:
 * public-id extraction from every URL shape the codebase stores, the
 * shared-asset guard, and draft-retention candidate selection.
 *
 * See docs/privacy-deletion.md for the end-to-end picture.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Public-id extraction
// ---------------------------------------------------------------------------

const RESOURCE_TYPES = new Set(['image', 'video', 'raw']);

// Delivery types whose URL path carries a real public id we own. `fetch`
// (and friends like `youtube`) embed a remote URL instead — never extractable.
const EXTRACTABLE_DELIVERY_TYPES = new Set(['upload', 'private', 'authenticated']);

// One transformation group: comma-joined params ("c_limit,w_400,q_auto") or a
// single param ("f_jpg"). Param names are 1-3 chars (w_, h_, dpr_, ar_, t_ for
// named transforms), which deliberately does NOT match our own folder names
// like "user_<cuid>" (4+ chars before the underscore).
const SINGLE_TRANSFORM_RE = /^[a-z]{1,3}_[^/]+$/;
const VERSION_RE = /^v\d+$/;

function isTransformationSegment(segment: string): boolean {
  return segment.includes(',') || SINGLE_TRANSFORM_RE.test(segment);
}

/**
 * Extracts the Cloudinary public id from a delivery URL, or returns null for
 * anything that is not a Cloudinary-owned asset URL.
 *
 * Handles every URL shape this codebase stores:
 * - plain upload responses:      .../image/upload/v123/user_x/uploads/abc.jpg
 * - generated illustrations:     .../image/upload/v123/storywink/<bookId>/generated/abc.png
 * - character sheets:            .../image/upload/v123/storywink/<bookId>/refs/abc.png
 * - HEIC delivery rewrites:      .../upload/f_jpg,fl_force_strip/v123/user_x/uploads/abc.heic
 * - derived thumbnails:          .../upload/c_limit,w_400,q_auto/v123/user_x/uploads/abc.jpg
 * - vision-optimized URLs:       .../upload/c_limit,w_2048,h_2048,q_auto/v123/...
 * - unversioned / folderless URLs, query strings, URL-encoded characters
 *
 * For image/video resources the trailing format extension is stripped (it is
 * a delivery format, not part of the public id). For raw resources the
 * extension IS part of the public id and is kept.
 */
export function extractCloudinaryPublicId(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.trim().length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'cloudinary.com' && !host.endsWith('.cloudinary.com')) return null;

  // Path shape: /<cloudName>/<resourceType>/<deliveryType>/[transforms/][vN/]<publicId>[.<ext>]
  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length < 4) return null;

  const [, resourceType, deliveryType, ...rest] = segments;
  if (!RESOURCE_TYPES.has(resourceType)) return null;
  if (!EXTRACTABLE_DELIVERY_TYPES.has(deliveryType)) return null;

  // Skip transformation groups — but never the final segment, which must
  // remain as the public id.
  let i = 0;
  while (i < rest.length - 1 && isTransformationSegment(rest[i])) i += 1;

  // Optional version marker (consume at most one).
  if (i < rest.length - 1 && VERSION_RE.test(rest[i])) i += 1;

  let publicId = rest.slice(i).join('/');
  try {
    publicId = decodeURIComponent(publicId);
  } catch {
    // Malformed escape sequence — keep the raw form rather than dropping it.
  }

  if (resourceType !== 'raw') {
    publicId = publicId.replace(/\.[a-zA-Z0-9]{1,5}$/, '');
  }

  return publicId.length > 0 ? publicId : null;
}

// ---------------------------------------------------------------------------
// Collection helpers (what a book/user owns in Cloudinary)
// ---------------------------------------------------------------------------

/** Minimal Book projection needed to collect its generated Cloudinary content. */
export interface BookGeneratedContent {
  pages: ReadonlyArray<{ generatedImageUrl: string | null }>;
  coverImageUrl: string | null;
  characterReferences?: unknown;
}

/**
 * Tolerant reader for Book.characterReferences (Json column): returns the
 * sheet URLs of well-formed entries, ignores everything else.
 */
export function extractCharacterReferenceUrls(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  const urls: string[] = [];
  for (const entry of json) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { url?: unknown }).url === 'string'
    ) {
      urls.push((entry as { url: string }).url);
    }
  }
  return urls;
}

/**
 * Public ids of everything the app GENERATED for a book: page illustrations,
 * the cover render, and character sheets. Original photos are intentionally
 * excluded — they belong to Asset rows (which carry publicId directly) and
 * need the shared-asset guard.
 */
export function collectBookGeneratedPublicIds(book: BookGeneratedContent): string[] {
  const urls: Array<string | null> = [
    ...book.pages.map((p) => p.generatedImageUrl),
    book.coverImageUrl,
    ...extractCharacterReferenceUrls(book.characterReferences),
  ];

  const ids = new Set<string>();
  for (const url of urls) {
    const publicId = extractCloudinaryPublicId(url);
    if (publicId) ids.add(publicId);
  }
  return [...ids];
}

/**
 * The book-scoped Cloudinary folder every worker upload targets
 * (`storywink/<bookId>/generated`, `storywink/<bookId>/refs`). Deleting by
 * this prefix also catches renders that were superseded by QC re-illustration
 * rounds — their URLs are no longer on any row, but the binaries still exist.
 */
export function bookGeneratedFolderPrefix(bookId: string): string {
  return `storywink/${bookId}/`;
}

/** The per-user folder direct browser uploads land in (originals). */
export function userUploadsFolderPrefix(dbUserId: string): string {
  return `user_${dbUserId}/uploads/`;
}

// Defense in depth for prefix deletion: a bug that passed "storywink/" or
// "user_" would wipe the whole account. Only the two exact folder shapes the
// app writes to are ever accepted, and the scoping segment must be a
// plausible id (cuid-like), not empty or a wildcard.
const SAFE_PREFIX_RE = /^(storywink\/[a-z0-9][a-z0-9_-]{6,}\/|user_[a-z0-9][a-z0-9_-]{6,}\/uploads\/)$/i;

/** True only for prefixes shaped exactly like the app's scoped folders. */
export function isSafeCloudinaryPrefix(prefix: string): boolean {
  return typeof prefix === 'string' && SAFE_PREFIX_RE.test(prefix);
}

// ---------------------------------------------------------------------------
// Shared-asset guard
// ---------------------------------------------------------------------------

/**
 * Shared-asset guard: from the assets a doomed book references, keep only
 * those no OTHER book references (as a page photo or as a cover). The create
 * route accepts arbitrary owned assetIds, so two books CAN share one upload.
 *
 * `candidateAssetIds` — asset ids referenced by the book being deleted.
 * `externallyReferencedAssetIds` — asset ids referenced by any other book.
 */
export function excludeSharedAssetIds(
  candidateAssetIds: ReadonlyArray<string | null | undefined>,
  externallyReferencedAssetIds: Iterable<string | null | undefined>,
): string[] {
  const shared = new Set<string>();
  for (const id of externallyReferencedAssetIds) {
    if (typeof id === 'string' && id.length > 0) shared.add(id);
  }

  const deletable = new Set<string>();
  for (const id of candidateAssetIds) {
    if (typeof id === 'string' && id.length > 0 && !shared.has(id)) deletable.add(id);
  }
  return [...deletable];
}

// ---------------------------------------------------------------------------
// Draft-retention sweep
// ---------------------------------------------------------------------------

/**
 * A book qualifies for the draft-retention sweep only when it is still DRAFT
 * and has seen no activity (updatedAt) for at least `retentionDays`. Any
 * other status — including FAILED or PARTIAL — is never swept.
 */
export function isDraftSweepCandidate(
  book: { status: string; updatedAt: Date },
  now: Date,
  retentionDays: number,
): boolean {
  if (book.status !== 'DRAFT') return false;
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return false;
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return book.updatedAt.getTime() < cutoff;
}

// ---------------------------------------------------------------------------
// Cleanup job payload
// ---------------------------------------------------------------------------

export const ASSET_CLEANUP_REASONS = ['book_deleted', 'user_deleted', 'draft_expired'] as const;
export type AssetCleanupReason = (typeof ASSET_CLEANUP_REASONS)[number];

/**
 * Durable pre-delete marker (AppEvent name): written BEFORE the Book row is
 * deleted, carrying the full Cloudinary target list in props
 * ({publicIds, prefixes, reason}). If the deletion-job enqueue fails (or the
 * process dies in the delete->enqueue gap), the sweep's reconcile pass
 * re-enqueues from this record — without it the photos would be orphaned in
 * Cloudinary forever. A matching 'assets_deleted' / 'assets_delete_dry_run'
 * event for the same book marks the record satisfied.
 */
export const ASSET_CLEANUP_PENDING_EVENT = 'asset_cleanup_pending';

/** Payload contract between the enqueue points (web, sweep) and the worker. */
export const assetCleanupJobSchema = z.object({
  /** Exact Cloudinary public ids to delete (originals + generated). */
  publicIds: z.array(z.string().min(1).max(512)).max(50_000),
  /**
   * Optional scoped folder prefixes to purge (see isSafeCloudinaryPrefix).
   * Catches superseded QC renders and uploads that raced the deletion.
   */
  prefixes: z.array(z.string().min(1).max(512)).max(500).optional(),
  reason: z.enum(ASSET_CLEANUP_REASONS),
  /** Internal (database) user id, not the Clerk id. */
  userId: z.string().optional(),
  bookId: z.string().optional(),
});

export type AssetCleanupJobPayload = z.infer<typeof assetCleanupJobSchema>;

/** Split a list into API-sized batches (Cloudinary caps ids per call). */
export function chunkPublicIds(publicIds: ReadonlyArray<string>, size: number): string[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`chunkPublicIds: size must be a positive integer, got ${size}`);
  }
  const chunks: string[][] = [];
  for (let i = 0; i < publicIds.length; i += size) {
    chunks.push(publicIds.slice(i, i + size));
  }
  return chunks;
}
