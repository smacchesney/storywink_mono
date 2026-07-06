/**
 * Pure logic for the character-sheet pipeline (CHARACTER_SHEETS_ENABLED):
 * subject selection, Book.characterReferences keying/reuse, and source-photo
 * resolution. Kept free of prisma/cloudinary/SDK imports so it unit-tests
 * without infrastructure — orchestration lives in character-sheets.ts.
 */

import {
  CharacterDescription,
  CharacterIdentity,
  CharacterReferenceEntry,
  CharacterSheetRef,
} from '@storywink/shared/types';
import { optimizeCloudinaryUrlForVision, convertHeicToJpeg } from '@storywink/shared/utils';

// Hard caps (economics verifier corrections): worst-case sheet spend per book
// is bounded in code, not by hope. 3 generations ≈ +$0.30 at 2K pricing.
export const MAX_SHEET_GENERATIONS_PER_BOOK = 3;
export const SHEET_BUDGET_MS = 60_000;
export const MAX_SHEETS_PER_BOOK = 2;
export const MAX_SOURCE_PHOTOS_PER_SHEET = 3;
export const STYLE_EXEMPLARS_FOR_SHEET = 2;

/**
 * Feature flag for the whole character-sheet pipeline (sheet generation,
 * sheet refs on page/cover renders, sheet-as-QC-ground-truth, cover QC).
 * Default OFF — current behavior.
 *
 * KILL CRITERION (pre-committed): after ~50 books with sheets, compare
 * IllustrationQcResult.charScore for hadSheet=true vs hadSheet=false. If the
 * delta is below the judge-variance threshold established in Step 0 (the
 * minimum detectable delta from running QC twice on the same books), flip
 * this flag off — the sheet is unrecovered COGS that isn't earning its keep.
 */
export function characterSheetsEnabled(): boolean {
  return process.env.CHARACTER_SHEETS_ENABLED === 'true';
}

/** Number of distinct source photos we can anchor this character to. */
export function characterPhotoCount(character: CharacterDescription): number {
  if (character.appearsOnAssetIds) {
    return new Set(character.appearsOnAssetIds.filter(Boolean)).size;
  }
  return new Set(character.appearsOnPages).size;
}

/**
 * Picks up to 2 sheet subjects: the main child (role === 'main_child', or any
 * role starting with 'main' — roles are free-form strings, 'secondary' does
 * not exist in the data) plus the other character with the largest
 * appearsOnAssetIds count. Characters without any resolvable photo are
 * skipped — a sheet needs ground-truth pixels.
 */
export function selectSheetCharacters(
  characters: CharacterDescription[],
): CharacterDescription[] {
  const withPhotos = characters.filter(c => characterPhotoCount(c) > 0);

  const main =
    withPhotos.find(c => c.role === 'main_child') ??
    withPhotos.find(c => c.role.startsWith('main'));

  const byPhotoCount = withPhotos
    .filter(c => c !== main)
    .sort((a, b) => characterPhotoCount(b) - characterPhotoCount(a));

  const selected = [main, byPhotoCount[0]].filter(
    (c): c is CharacterDescription => Boolean(c),
  );
  return selected.slice(0, MAX_SHEETS_PER_BOOK);
}

/** Defensive parse of the Book.characterReferences Json column. */
export function parseCharacterReferences(json: unknown): CharacterReferenceEntry[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (e): e is CharacterReferenceEntry =>
      Boolean(e) &&
      typeof e === 'object' &&
      typeof (e as CharacterReferenceEntry).characterId === 'string' &&
      typeof (e as CharacterReferenceEntry).artStyle === 'string' &&
      typeof (e as CharacterReferenceEntry).url === 'string' &&
      typeof (e as CharacterReferenceEntry).validatedAt === 'string',
  );
}

/**
 * Upserts by (characterId, artStyle) — the reuse key. Entries for OTHER
 * styles are retained, so an A→B→A style flip re-buys nothing.
 */
export function upsertCharacterReference(
  entries: CharacterReferenceEntry[],
  entry: CharacterReferenceEntry,
): CharacterReferenceEntry[] {
  return [
    ...entries.filter(
      e => !(e.characterId === entry.characterId && e.artStyle === entry.artStyle),
    ),
    entry,
  ];
}

/**
 * Resolves the validated sheet refs for one art style, with character names
 * attached for prompt role-labeling. Used by the extraction worker (reuse
 * check) and by book-finalize (QC ground truth + hadSheet + requeue jobs).
 */
export function sheetRefsForStyle(
  referencesJson: unknown,
  artStyle: string | null | undefined,
  identity: CharacterIdentity | null,
): CharacterSheetRef[] {
  if (!artStyle) return [];
  return parseCharacterReferences(referencesJson)
    .filter(e => e.artStyle === artStyle)
    .slice(0, MAX_SHEETS_PER_BOOK)
    .map(e => ({
      characterId: e.characterId,
      name:
        identity?.characters?.find(c => c.characterId === e.characterId)?.name ?? null,
      url: e.url,
    }));
}

export interface PageWithAsset {
  assetId: string | null;
  asset: { url: string | null; thumbnailUrl: string | null } | null;
}

/**
 * Resolves a character's best source-photo URLs (vision-normalized).
 * Prefers appearsOnAssetIds (survives reorders); falls back to positional
 * appearsOnPages for identities produced by the extraction worker, which
 * always runs against the current page order.
 */
export function resolveCharacterPhotoUrls(
  character: CharacterDescription,
  pages: PageWithAsset[],
  max = MAX_SOURCE_PHOTOS_PER_SHEET,
): string[] {
  const rawUrls: string[] = [];

  if (character.appearsOnAssetIds?.some(Boolean)) {
    const assetIds = [...new Set(character.appearsOnAssetIds.filter(Boolean))];
    for (const assetId of assetIds) {
      const page = pages.find(p => p.assetId === assetId);
      const url = page?.asset?.url || page?.asset?.thumbnailUrl;
      if (url) rawUrls.push(url);
    }
  } else {
    for (const pageNumber of character.appearsOnPages) {
      const page = pages[pageNumber - 1];
      const url = page?.asset?.url || page?.asset?.thumbnailUrl;
      if (url) rawUrls.push(url);
    }
  }

  return [...new Set(rawUrls)]
    .slice(0, max)
    .map(url => optimizeCloudinaryUrlForVision(convertHeicToJpeg(url)));
}
