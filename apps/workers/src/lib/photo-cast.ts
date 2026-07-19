/**
 * Pure helper for the photo path's per-page cast presence (X16 W1, A6).
 *
 * Kept dependency-free (no Prisma, no BullMQ) per the repo's extract-pure-
 * helper testing convention, so the reorder-proof invariant is unit-testable.
 */

/** Minimal roster shape this helper reads; CharacterDescription satisfies it. */
export interface PhotoCastMember {
  characterId: string;
  appearsOnPages: number[];
  appearsOnAssetIds?: (string | null)[];
}

/**
 * The characterIds actually on THIS photo page.
 *
 * Presence is asset-stamp first (`appearsOnAssetIds`), which survives photo
 * reorders — the stamp binds a character to the concrete asset, not the
 * positional page number. `appearsOnPages` is the legacy/positional fallback
 * for rosters written before stamps existed (or when the page carries no
 * asset). An empty result is the caller's fail-open signal: no verifiable
 * presence → keep every sheet rather than starve the render of references.
 */
export function photoPresentCharacterIds(
  characters: PhotoCastMember[] | null | undefined,
  assetId: string | null | undefined,
  pageNumber: number,
): string[] {
  return (characters ?? [])
    .filter(
      (c) =>
        (!!assetId && (c.appearsOnAssetIds ?? []).includes(assetId)) ||
        (c.appearsOnPages ?? []).includes(pageNumber),
    )
    .map((c) => c.characterId);
}
