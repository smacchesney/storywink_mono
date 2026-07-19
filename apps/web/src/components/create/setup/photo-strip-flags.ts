/**
 * X17 B3 — thumbnail affordances. With a composed cover (coverAssetId null)
 * no photo IS the cover: the badge disappears and delete protection
 * re-anchors from "never position 0" to "keep at least MIN_KEEP_PHOTOS".
 * Legacy books (coverAssetId set) keep today's semantics exactly — this
 * branches on book state, never on the flag.
 */
export const MIN_KEEP_PHOTOS = 2;

export function stripThumbFlags(
  index: number,
  photoCount: number,
  hasPhotoCover: boolean,
): { isCover: boolean; removable: boolean } {
  if (hasPhotoCover) {
    return { isCover: index === 0, removable: index !== 0 };
  }
  return { isCover: false, removable: photoCount > MIN_KEEP_PHOTOS };
}
