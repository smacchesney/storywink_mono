/**
 * X17 outing-v2 flags (web side). House pattern: one exported function per
 * flag, default OFF, rollback is unset-the-var.
 */

/**
 * COVER_COMPOSED_ENABLED (X17 A1): new PHOTO_STORY books get a null
 * coverAssetId — no photo is spent on the cover. Workers key the composed
 * cover off book state (coverAssetId == null), never off this flag, so the
 * two services can flip out of sync safely.
 */
export function coverComposedEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = (env.COVER_COMPOSED_ENABLED || '').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * ENSEMBLE_BOOKS_ENABLED (X17 A2, web side): the book PATCH route accepts
 * castMode / starCharacterId / castMemberIds. Off: those fields are stripped
 * (spec off-behavior — "castMode ignored, star path").
 */
export function ensembleBooksEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = (env.ENSEMBLE_BOOKS_ENABLED || '').trim().toLowerCase();
  return value === 'true' || value === '1';
}
