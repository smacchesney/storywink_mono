/**
 * X17 A2/A3 — ensemble-cast helpers (ENSEMBLE_BOOKS_ENABLED, workers side).
 * Pure and dependency-free so every consumer (story prompt threading, sheet
 * selection, the composed-cover step) reads ONE definition of "this book is
 * an ensemble".
 */

/** One confirmed member is a star, not an ensemble. */
export const MIN_ENSEMBLE_MEMBERS = 2;

export function ensembleBooksEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = (env.ENSEMBLE_BOOKS_ENABLED || '').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/** Defensive parse of the Book.castMemberIds Json column (string[], deduped). */
export function parseCastMemberIds(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return [...new Set(json.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

/**
 * The confirmed ensemble member ids for a book, or null when the book runs
 * the star path (flag off, castMode !== 'ensemble', or < 2 members).
 */
export function ensembleMemberIds(
  book: { castMode: string | null; castMemberIds: unknown },
  env: Record<string, string | undefined> = process.env,
): string[] | null {
  if (!ensembleBooksEnabled(env)) return null;
  if (book.castMode !== 'ensemble') return null;
  const ids = parseCastMemberIds(book.castMemberIds);
  return ids.length >= MIN_ENSEMBLE_MEMBERS ? ids : null;
}
