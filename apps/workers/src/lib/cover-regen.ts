import type { Logger } from 'pino';
import prisma from '../database/index.js';
import type { CharacterIdentity, CharacterSheetRef, CoverQCResult } from '@storywink/shared/types';
import {
  resolveCoverPage,
  optimizeCloudinaryUrlForVision,
  convertHeicToJpeg,
} from '@storywink/shared/utils';
import { isValidStyle } from '@storywink/shared/prompts/styles';
import { generateAndStoreCover } from './cover-generation.js';
import { fetchImageInput, resizeForReference } from './images.js';

/** The finalize-worker book shape the regen needs (X15: also loadable by the
 * illustration worker's cover-regen flow child via loadBookForCoverRegen). */
export interface CoverRegenBook {
  id: string;
  title: string | null;
  artStyle: string | null;
  language: string | null;
  coverAssetId: string | null;
  bookType?: string | null;
  characterIdentity: unknown;
  pages: Array<{
    assetId: string | null;
    text: string | null;
    illustrationNotes: string | null;
    pageNumber: number;
    generatedImageUrl: string | null;
    isTitlePage?: boolean;
    [key: string]: unknown;
  }>;
}

export async function loadBookForCoverRegen(bookId: string): Promise<CoverRegenBook | null> {
  return (await prisma.book.findUnique({
    where: { id: bookId },
    include: { pages: { orderBy: { pageNumber: 'asc' } } },
  })) as CoverRegenBook | null;
}

/**
 * Re-render the QC-failed cover once, anchored exactly like the original
 * cover render but sourced from STORED urls (no in-memory buffers) — which is
 * what lets this run as a requeue-flow child instead of inline in finalize
 * (X15). Non-fatal on every path: a failed regen keeps the existing cover.
 */
export async function regenerateCoverFromQc(
  book: CoverRegenBook,
  sheets: CharacterSheetRef[],
  coverResult: CoverQCResult,
  logger: Logger,
): Promise<void> {
  try {
    logger.info(
      { bookId: book.id, issues: coverResult.issues, titleMatches: coverResult.titleMatches },
      'Cover failed QC — regenerating once with cover-targeted feedback',
    );

    if (!book.artStyle || !isValidStyle(book.artStyle)) {
      logger.warn(
        { bookId: book.id, artStyle: book.artStyle },
        'Cover regen skipped: invalid art style',
      );
      return;
    }

    const isAvatarBook = book.bookType === 'AVATAR_STORY';
    const titlePage = resolveCoverPage(book.pages, book.coverAssetId, book.bookType);
    if (!titlePage?.text) {
      logger.warn({ bookId: book.id }, 'Cover regen skipped: no title page with text');
      return;
    }

    // Photo books anchor to the title photo; avatar books anchor to the
    // approved interior render of page 1 (same anchor the original cover
    // render used — there is no photo anywhere in the book).
    let contentImage;
    if (isAvatarBook) {
      if (!titlePage.generatedImageUrl) {
        logger.warn(
          { bookId: book.id },
          'Cover regen skipped: avatar title page has no interior render',
        );
        return;
      }
      contentImage = await fetchImageInput(
        optimizeCloudinaryUrlForVision(titlePage.generatedImageUrl),
      );
    } else {
      const asset = titlePage.assetId
        ? await prisma.asset.findUnique({ where: { id: titlePage.assetId } })
        : null;
      const rawAnchorUrl = asset?.url || asset?.thumbnailUrl;
      if (!rawAnchorUrl) {
        logger.warn({ bookId: book.id }, 'Cover regen skipped: title page has no source photo');
        return;
      }
      // Same vision-normalized anchor the original render used.
      contentImage = await fetchImageInput(
        optimizeCloudinaryUrlForVision(convertHeicToJpeg(rawAnchorUrl)),
      );
    }

    const sheetRefs = [];
    for (const sheet of sheets) {
      try {
        sheetRefs.push(await fetchImageInput(optimizeCloudinaryUrlForVision(sheet.url)));
      } catch (sheetError: any) {
        logger.warn(
          { bookId: book.id, characterId: sheet.characterId, error: sheetError.message },
          'Cover regen: failed to fetch character sheet — continuing without it',
        );
      }
    }

    // Avatar books: the interior render IS the content anchor above — a
    // second copy as a reference would be redundant payload.
    let interiorRenderRef = null;
    if (!isAvatarBook && titlePage.generatedImageUrl) {
      try {
        const interior = await fetchImageInput(
          optimizeCloudinaryUrlForVision(titlePage.generatedImageUrl),
        );
        interiorRenderRef = await resizeForReference(interior.buffer);
      } catch (interiorError: any) {
        logger.warn(
          { bookId: book.id, error: interiorError.message },
          'Cover regen: failed to fetch interior title render — continuing without it',
        );
      }
    }

    const outcome = await generateAndStoreCover({
      bookId: book.id,
      styleKey: book.artStyle,
      bookTitle: book.title,
      pageText: titlePage.text,
      illustrationNotes: titlePage.illustrationNotes ?? null,
      language: book.language || 'en',
      characterIdentity: book.characterIdentity as CharacterIdentity | null,
      pageNumber: titlePage.pageNumber,
      contentImage,
      characterSheetRefs: sheetRefs,
      interiorRenderRef,
      ...(isAvatarBook ? { contentAnchor: 'interior' as const } : {}),
      // This is the one place cover feedback is allowed to flow: it was
      // scored against the cover itself, under the cover rubric.
      qcFeedback: coverResult.suggestedPromptAdditions,
      logger,
    });

    if ('coverUrl' in outcome) {
      logger.info(
        { bookId: book.id, coverUrl: outcome.coverUrl },
        'Cover regenerated after QC failure',
      );
    } else {
      logger.warn(
        { bookId: book.id, reason: outcome.blockedReason },
        'Cover regen blocked — keeping existing cover',
      );
    }
  } catch (error: any) {
    logger.error(
      { bookId: book.id, error: error.message },
      'Cover regen failed (non-fatal) — keeping existing cover',
    );
  }
}
