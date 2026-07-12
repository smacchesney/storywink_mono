/**
 * Bridge pages (BRIDGE_PAGES_ENABLED) — pure helpers.
 *
 * A bridge page is an app-authored in-between page the story model may insert
 * where a narrative beat is missing between two photo anchors (or after the
 * last photo). Bridges are ordinary Page rows (source=BRIDGE, assetId null,
 * bridgeScene Json) so status/QC/preview/PDF all treat them as normal pages.
 *
 * Everything here is deterministic and dependency-free (no Prisma/BullMQ) so
 * the validation, insertion-plan, and anchor-resolution logic is unit-testable.
 */

import type { StoryBridgePageResponse } from '@storywink/shared/prompts/story';
import { bridgePageResponseSchema } from '@storywink/shared/schemas';

/** Workers env flag — default OFF. Gates bridge REQUESTS (story prompt +
 * schema + insertion) and first-run/retry flow inclusion. The illustration
 * worker's render branch is deliberately NOT gated: it keys on the DB row
 * (page.source === 'BRIDGE'), so rows created while the flag was on keep
 * rendering/requeuing correctly after a rollback. */
export function bridgePagesEnabled(): boolean {
  return process.env.BRIDGE_PAGES_ENABLED === 'true';
}

/**
 * PURGE-AT-START decision (X6d-aware): stale BRIDGE rows from a previous
 * story run are purged before regeneration — EXCEPT on AVATAR_STORY books,
 * where every page is a bridge-source row authored at creation time; purging
 * them would delete the entire book. Pure and pinned by tests.
 */
export function shouldPurgeStaleBridges(
  bookType: string | null | undefined,
  pages: { source: string }[],
): boolean {
  return bookType !== 'AVATAR_STORY' && pages.some((p) => p.source === 'BRIDGE');
}

/**
 * Hard cap on bridges per book: min(2, 23 - photoCount).
 * 23 total rows keeps the Lulu interior at 2 + 2N <= 48 (saddle-stitch
 * ceiling); create already caps photos at 23, so bridges may only spend the
 * remaining headroom.
 */
export function bridgeCapForPhotoCount(photoCount: number): number {
  return Math.max(0, Math.min(2, 23 - photoCount));
}

export interface DroppedBridge {
  reason:
    'malformed' | 'bad-gap' | 'duplicate-gap' | 'over-cap' | 'unknown-character' | 'no-roster';
  afterPhotoPage?: number;
}

export interface BridgeValidationResult {
  accepted: StoryBridgePageResponse[];
  dropped: DroppedBridge[];
}

/**
 * Validate-or-DROP: a bad bridge must never fail the story — the book simply
 * proceeds as a photo-per-page book. Rules (in order):
 * - entry must match the response shape (zod) with non-empty text
 * - afterPhotoPage must be an integer in [1..photoCount] (photoCount = a
 *   trailing wind-down; nothing before the first photo by construction)
 * - every charactersPresent id must exist in the roster (identity-less books
 *   have an empty roster and therefore get NO bridges — an ungrounded bridge
 *   is exactly the drift nightmare)
 * - at most ONE bridge per gap (first proposal wins)
 * - at most bridgeCapForPhotoCount(photoCount) bridges total
 */
export function validateBridgePages(
  raw: unknown,
  opts: { photoCount: number; rosterCharacterIds: string[] },
): BridgeValidationResult {
  const accepted: StoryBridgePageResponse[] = [];
  const dropped: DroppedBridge[] = [];

  if (!Array.isArray(raw) || raw.length === 0) {
    return { accepted, dropped };
  }

  const cap = bridgeCapForPhotoCount(opts.photoCount);
  const roster = new Set(opts.rosterCharacterIds);
  const usedGaps = new Set<number>();

  for (const entry of raw) {
    const parsed = bridgePageResponseSchema.safeParse(entry);
    if (!parsed.success) {
      dropped.push({ reason: 'malformed' });
      continue;
    }
    const bridge = parsed.data;

    if (
      !Number.isInteger(bridge.afterPhotoPage) ||
      bridge.afterPhotoPage < 1 ||
      bridge.afterPhotoPage > opts.photoCount
    ) {
      dropped.push({ reason: 'bad-gap', afterPhotoPage: bridge.afterPhotoPage });
      continue;
    }
    if (roster.size === 0) {
      dropped.push({ reason: 'no-roster', afterPhotoPage: bridge.afterPhotoPage });
      continue;
    }
    if (!bridge.scene.charactersPresent.every((id) => roster.has(id))) {
      dropped.push({ reason: 'unknown-character', afterPhotoPage: bridge.afterPhotoPage });
      continue;
    }
    if (usedGaps.has(bridge.afterPhotoPage)) {
      dropped.push({ reason: 'duplicate-gap', afterPhotoPage: bridge.afterPhotoPage });
      continue;
    }
    if (accepted.length >= cap) {
      dropped.push({ reason: 'over-cap', afterPhotoPage: bridge.afterPhotoPage });
      continue;
    }

    usedGaps.add(bridge.afterPhotoPage);
    accepted.push(bridge as StoryBridgePageResponse);
  }

  return { accepted, dropped };
}

export interface SequenceEntry {
  kind: 'photo' | 'bridge';
  /** Present on kind='photo': the existing Page row id. */
  photoPageId?: string;
  /** Present on kind='bridge': the accepted bridge to insert. */
  bridge?: StoryBridgePageResponse;
  /** Final 0-based index. */
  index: number;
  /** Final 1-based pageNumber. */
  pageNumber: number;
}

/**
 * Interleave accepted bridges into the photo-page order and assign the final
 * index/pageNumber for every row (photo rows get renumbered, bridge rows get
 * created at these positions). photoPageIds must be in reading order.
 */
export function planPageSequence(
  photoPageIds: string[],
  accepted: StoryBridgePageResponse[],
): SequenceEntry[] {
  const byGap = new Map<number, StoryBridgePageResponse>();
  for (const bridge of accepted) byGap.set(bridge.afterPhotoPage, bridge);

  const sequence: SequenceEntry[] = [];
  const push = (entry: Omit<SequenceEntry, 'index' | 'pageNumber'>) => {
    sequence.push({ ...entry, index: sequence.length, pageNumber: sequence.length + 1 });
  };

  photoPageIds.forEach((photoPageId, i) => {
    push({ kind: 'photo', photoPageId });
    const bridge = byGap.get(i + 1);
    if (bridge) push({ kind: 'bridge', bridge });
  });

  return sequence;
}

export interface AnchorCandidate {
  pageNumber: number;
  source: string;
  /** The photo URL this page could anchor to (asset.url || thumbnailUrl). */
  assetUrl: string | null;
}

/**
 * Resolve a bridge page's anchor photo: the nearest PRECEDING photo page
 * with an asset URL by default, else the nearest FOLLOWING one. When the
 * authored scene says outfitFrom='next' (the outfits change AT this bridge,
 * e.g. "getting dressed for the beach"), the preference flips: nearest
 * FOLLOWING photo, falling back to preceding. Resolved from DB state at
 * render time — job data never carries more than a cache of this.
 * Returns null only when the book has no photo pages at all (cannot happen
 * through the app: create requires >= 1 photo and the delete route keeps a
 * 2-page floor).
 */
export function resolveBridgeAnchor(
  pages: AnchorCandidate[],
  bridgePageNumber: number,
  outfitFrom: 'previous' | 'next' = 'previous',
): AnchorCandidate | null {
  const photos = pages
    .filter((p) => p.source === 'PHOTO' && !!p.assetUrl)
    .sort((a, b) => a.pageNumber - b.pageNumber);
  if (photos.length === 0) return null;

  const preceding = photos.filter((p) => p.pageNumber < bridgePageNumber);
  const following = photos.filter((p) => p.pageNumber > bridgePageNumber);

  if (outfitFrom === 'next') {
    return following[0] ?? preceding[preceding.length - 1] ?? null;
  }
  return preceding[preceding.length - 1] ?? following[0] ?? null;
}
