/**
 * Cover illustration generation, shared by:
 *  - the illustration worker (title-page jobs render the cover right after
 *    the interior title illustration), and
 *  - the book-finalize worker (cover QC's single regeneration round).
 *
 * One implementation so the QC regen can never drift from the original
 * cover path (prompt, logo overlay, upload target).
 */

import { v2 as cloudinary } from 'cloudinary';
import type { Logger } from 'pino';
import prisma from '../database/index.js';
import { CharacterIdentity } from '@storywink/shared';
import {
  createIllustrationPrompt,
  IllustrationPromptOptions,
} from '@storywink/shared/prompts/illustration';
import { STYLE_LIBRARY, StyleKey } from '@storywink/shared/prompts/styles';
import { getIllustrator } from './illustrators/index.js';
import type { IllustrationImageInput } from './illustrators/index.js';
import { fetchImageInput } from './images.js';
import { addLogoToTitlePage, upscaleForPrint } from '../utils/image-processing.js';

export interface CoverGenerationOptions {
  bookId: string;
  styleKey: StyleKey;
  bookTitle: string | null;
  pageText: string;
  illustrationNotes: string | null;
  language: string;
  characterIdentity: CharacterIdentity | null;
  pageNumber: number;
  /**
   * Image 1 of the render: the title page's source photo (vision-normalized)
   * for photo books, or the approved interior render of the cover scene for
   * AVATAR_STORY books (contentAnchor: 'interior').
   */
  contentImage: IllustrationImageInput;
  /** Validated character sheets (CHARACTER_SHEETS_ENABLED); empty otherwise. */
  characterSheetRefs: IllustrationImageInput[];
  /** The approved interior title-page render, downscaled for reference use. */
  interiorRenderRef: IllustrationImageInput | null;
  /**
   * AVATAR_STORY (X6d): 'interior' re-roles image 1 as the approved interior
   * render being repainted. Absent/'photo' keeps the photo-book cover prompt
   * byte-identical.
   */
  contentAnchor?: 'photo' | 'interior';
  /**
   * Cover-targeted QC feedback ONLY (finalize's cover regen round). The
   * interior render's qcFeedback must never leak here — it describes a
   * different image.
   */
  qcFeedback: string | null;
  logger: Logger;
}

export type CoverGenerationResult = { coverUrl: string } | { blockedReason: string };

/**
 * Renders the cover, upscales it for print, applies the logo overlay,
 * uploads it to the stable `cover_illustration` public id, and stores the
 * URL on Book.coverImageUrl. Throws on transient errors (callers treat
 * cover failure as non-fatal); returns blockedReason on content blocks.
 */
export async function generateAndStoreCover(
  opts: CoverGenerationOptions,
): Promise<CoverGenerationResult> {
  const {
    bookId,
    styleKey,
    bookTitle,
    pageText,
    illustrationNotes,
    language,
    characterIdentity,
    pageNumber,
    contentImage,
    characterSheetRefs,
    interiorRenderRef,
    qcFeedback,
    logger,
  } = opts;

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  const styleData = STYLE_LIBRARY[styleKey];

  // Use cover-specific style references if available. When character sheets
  // ride along, trim the exemplars to 2 (same rule as interior pages) to
  // keep the reference stack inside budget.
  const allCoverRefUrls = styleData.coverReferenceImageUrls?.length
    ? [...styleData.coverReferenceImageUrls]
    : [...styleData.referenceImageUrls];
  const coverStyleRefUrls =
    characterSheetRefs.length > 0 ? allCoverRefUrls.slice(0, 2) : allCoverRefUrls;

  const coverRefBuffers = await Promise.all(coverStyleRefUrls.map(fetchImageInput));

  const coverPromptInput: IllustrationPromptOptions = {
    style: styleKey,
    pageText,
    bookTitle,
    isTitlePage: true,
    illustrationNotes,
    language,
    referenceImageCount: coverRefBuffers.length,
    characterIdentity,
    pageNumber,
    qcFeedback,
    characterSheetCount: characterSheetRefs.length,
    interiorRenderCount: interiorRenderRef ? 1 : 0,
    ...(opts.contentAnchor && opts.contentAnchor !== 'photo'
      ? { contentAnchor: opts.contentAnchor }
      : {}),
  };
  const coverTextPrompt = createIllustrationPrompt(coverPromptInput);

  const illustrator = getIllustrator();
  const coverResult = await illustrator.generate({
    contentImage,
    characterRefs: [...characterSheetRefs, ...(interiorRenderRef ? [interiorRenderRef] : [])],
    styleRefs: coverRefBuffers,
    prompt: coverTextPrompt,
  });

  if (!coverResult.imageBase64) {
    logger.warn(
      { bookId, pageNumber, reason: coverResult.blockedReason },
      'Cover illustration generation returned no image data',
    );
    return { blockedReason: coverResult.blockedReason ?? 'No image data in response.' };
  }

  let coverBuffer = Buffer.from(coverResult.imageBase64, 'base64');

  // Upscale for print
  coverBuffer = await upscaleForPrint(coverBuffer);

  // Apply logo overlay to cover illustration
  coverBuffer = await addLogoToTitlePage(coverBuffer);

  // Upload cover illustration to Cloudinary
  const coverUpload = await new Promise<{ secure_url?: string }>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: `storywink/${bookId}/generated`,
          public_id: `cover_illustration`,
          overwrite: true,
          tags: [`book:${bookId}`, `cover`, `style:${styleKey}`],
          resource_type: 'image',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result ?? {});
        },
      )
      .end(coverBuffer);
  });

  if (!coverUpload.secure_url) {
    throw new Error('Cloudinary cover upload did not return a secure URL.');
  }

  await prisma.book.update({
    where: { id: bookId },
    data: { coverImageUrl: coverUpload.secure_url },
  });

  logger.info(
    { bookId, coverUrl: coverUpload.secure_url },
    'Cover illustration stored in Book.coverImageUrl',
  );

  return { coverUrl: coverUpload.secure_url };
}
