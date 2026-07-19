import { PAGE_TEXT } from '@storywink/shared/constants';
import type { BookWithPages } from './types.js';

export const MAX_DEDICATION_NAMES = 4;

/**
 * X17 A2: localized display list for dedication/ending — "Leo, Maya & Sam";
 * beyond 4 names the tail becomes a localized "and friends"; ja joins with と.
 * Null when no usable name exists (caller falls back).
 */
export function formatCastNames(names: string[], language: string): string | null {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (clean.length === 0) return null;
  const texts = PAGE_TEXT[language as keyof typeof PAGE_TEXT] || PAGE_TEXT.en;
  const overflow = clean.length > MAX_DEDICATION_NAMES;
  const listed = clean.slice(0, MAX_DEDICATION_NAMES);
  if (language === 'ja') {
    const joined = listed.join('と ');
    return overflow ? `${joined}${texts.andFriends}` : joined;
  }
  if (overflow) return `${listed.join(', ')} ${texts.andFriends}`;
  return listed.length === 1
    ? listed[0]
    : `${listed.slice(0, -1).join(', ')} & ${listed[listed.length - 1]}`;
}

/**
 * The dedication/ending display name for a book. Ensemble books list their
 * NAMED members in castMemberIds order (unnamed members are excluded; fewer
 * than two named members falls back to childName). Star/legacy books return
 * childName untouched — the frozen Lulu snapshot rides this byte-identical path.
 * Data-driven off Book.castMode, deliberately not the env flag: an ensemble
 * book stays an ensemble book in print even after a flag rollback.
 */
export function castDisplayName(
  bookData: Pick<
    BookWithPages,
    'castMode' | 'castMemberIds' | 'characterIdentity' | 'childName' | 'language'
  >,
): string | null {
  if (bookData.castMode !== 'ensemble') return bookData.childName;
  const memberIds = Array.isArray(bookData.castMemberIds)
    ? bookData.castMemberIds.filter((id): id is string => typeof id === 'string')
    : [];
  const identity = bookData.characterIdentity as {
    characters?: { characterId: string; name?: string | null }[];
  } | null;
  const names = memberIds
    .map((id) => identity?.characters?.find((c) => c.characterId === id)?.name?.trim())
    .filter((n): n is string => !!n);
  // A lone named member is a star, not an ensemble: mirror the workers'
  // MIN_ENSEMBLE_MEMBERS=2 convention (apps/workers/src/lib/ensemble.ts) but gate
  // on RESOLVED names — that is what actually prints. Fewer than 2 named members
  // (one member id, or two ids where only one resolves) falls back to childName,
  // so a single-member 'ensemble' can never print the wrong lone name.
  if (names.length < 2) return bookData.childName;
  return formatCastNames(names, bookData.language || 'en') ?? bookData.childName;
}
