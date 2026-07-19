/**
 * X17 A1 — pure logic for the finalize composed-cover step: eligibility,
 * hero-photo resolution, starred-cast resolution, and style-anchor selection.
 * Dependency-free (no prisma/cloudinary) so it unit-tests without
 * infrastructure; orchestration lives in composed-cover.ts.
 */

import type { CharacterIdentity } from '@storywink/shared/types';
import { parseCastMemberIds } from './ensemble.js';

export const MAX_COVER_HERO_PHOTOS = 3;

export interface ComposedCoverBookState {
  bookType: string;
  coverAssetId: string | null;
  coverImageUrl: string | null;
  artStyle: string | null;
}

/**
 * Keyed off BOOK STATE, never off COVER_COMPOSED_ENABLED: a null-cover photo
 * book always gets a composed-cover attempt even if web and workers flip out
 * of sync. Legacy books (coverAssetId set) and already-covered books skip —
 * which also makes the step idempotent across scoped finalize re-runs.
 */
export function composedCoverEligible(book: ComposedCoverBookState): boolean {
  return (
    book.bookType !== 'AVATAR_STORY' &&
    book.coverAssetId == null &&
    !book.coverImageUrl &&
    !!book.artStyle
  );
}

/**
 * Hero assetIds still on the book, order preserved (perception ranked best
 * first), deduped, capped at 3; falls back to the book's first photo when
 * none survive (legacy books, failed perception, removed photos).
 */
export function resolveHeroAssetIds(
  coverHeroAssetIds: unknown,
  pages: { assetId: string | null }[],
): string[] {
  const onBook = new Set(pages.map((p) => p.assetId).filter((id): id is string => !!id));
  const heroes: string[] = [];
  for (const id of Array.isArray(coverHeroAssetIds) ? coverHeroAssetIds : []) {
    if (typeof id === 'string' && onBook.has(id) && !heroes.includes(id)) heroes.push(id);
  }
  if (heroes.length > 0) return heroes.slice(0, MAX_COVER_HERO_PHOTOS);
  const first = pages.find((p) => p.assetId);
  return first?.assetId ? [first.assetId] : [];
}

/**
 * The characterIds the cover must star: confirmed ensemble members, else the
 * parent-picked star, else the perception main_child guess.
 */
export function starredCharacterIds(book: {
  castMode: string | null;
  castMemberIds: unknown;
  starCharacterId: string | null;
  characterIdentity: unknown;
}): string[] {
  if (book.castMode === 'ensemble') {
    const members = parseCastMemberIds(book.castMemberIds);
    if (members.length) return members;
  }
  if (book.starCharacterId) return [book.starCharacterId];
  const identity = book.characterIdentity as CharacterIdentity | null;
  const main = identity?.characters?.find((c) => c.role === 'main_child');
  return main ? [main.characterId] : [];
}

export interface StyleAnchorPage {
  pageId: string;
  pageNumber: number;
  generatedImageUrl: string | null;
}

export interface StyleAnchorQcRow {
  pageId: string | null;
  overallScore: number | null;
  passed: boolean;
  qcRound: number;
}

/**
 * The interior render the cover anchors palette/style to: a QC-passing page
 * with the most starred members present (ties → higher QC score → earlier
 * page). Falls back gracefully (best-scored, then first render) — the anchor
 * is a style reference, not identity truth, so any render beats none.
 */
export function selectStyleAnchorPage(
  pages: StyleAnchorPage[],
  qcRows: StyleAnchorQcRow[],
  starredIds: string[],
  identity: CharacterIdentity | null,
): StyleAnchorPage | null {
  const rendered = pages.filter((p) => p.generatedImageUrl);
  if (rendered.length === 0) return null;

  // Latest QC row per page wins (re-render rounds supersede round 0).
  const latestByPage = new Map<string, StyleAnchorQcRow>();
  for (const row of qcRows) {
    if (!row.pageId) continue;
    const prior = latestByPage.get(row.pageId);
    if (!prior || row.qcRound >= prior.qcRound) latestByPage.set(row.pageId, row);
  }

  const starred = new Set(starredIds);
  const starsOnPage = (pageNumber: number): number =>
    (identity?.characters ?? []).filter(
      (c) => starred.has(c.characterId) && c.appearsOnPages.includes(pageNumber),
    ).length;

  const ranked = rendered
    .map((p) => {
      const qc = latestByPage.get(p.pageId);
      return {
        page: p,
        passed: qc?.passed === true,
        score: qc?.overallScore ?? -1,
        stars: starsOnPage(p.pageNumber),
      };
    })
    .sort(
      (a, b) =>
        Number(b.passed) - Number(a.passed) ||
        b.stars - a.stars ||
        b.score - a.score ||
        a.page.pageNumber - b.page.pageNumber,
    );
  return ranked[0].page;
}
