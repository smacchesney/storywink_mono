/**
 * Palette normalization (PALETTE_NORMALIZE_ENABLED) — orchestration.
 *
 * Runs in book-finalize once a book's full (non-scoped) run is completing:
 * every interior page render is nudged toward the title-page render's color
 * statistics with a partial-strength (40%) channel-mean/std transfer, then
 * re-uploaded under the same Cloudinary public_id. The cover and character
 * sheets are never touched (the cover is not a Page row; sheets live under
 * refs/), and the title page is the reference so it is skipped too.
 *
 * Failure posture: NEVER throws, and a hard wall-clock budget
 * (PALETTE_BUDGET_MS) silently skips whatever pages remain — an
 * un-normalized page is exactly what the user would have gotten before this
 * feature existed. Math lives in palette.helpers.ts (tested).
 */

import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import type { Logger } from 'pino';
import { isTitlePage } from '@storywink/shared/utils';
import prisma from '../database/index.js';
import { fetchImageInput } from './images.js';
import {
  PALETTE_BUDGET_MS,
  PALETTE_STRENGTH,
  computeChannelStats,
  computeTransferCoefficients,
  isNearIdentity,
  meanDelta,
  paletteNormalizeEnabled,
  type ChannelStats,
} from './palette.helpers.js';

export { paletteNormalizeEnabled } from './palette.helpers.js';

/** Downscale size for computing channel statistics — plenty for mean/std. */
const STATS_SAMPLE_SIZE = 64;

interface PalettePage {
  id: string;
  pageNumber: number;
  assetId: string | null;
  generatedImageUrl: string | null;
}

export interface NormalizeBookPaletteParams {
  bookId: string;
  /** Book.artStyle — only used to keep the re-upload's tag set intact. */
  artStyle: string | null;
  coverAssetId: string | null;
  pages: PalettePage[];
  logger: Logger;
}

async function statsForBuffer(buffer: Buffer): Promise<ChannelStats> {
  const raw = await sharp(buffer)
    .resize(STATS_SAMPLE_SIZE, STATS_SAMPLE_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  return computeChannelStats(new Uint8Array(raw), 3);
}

function uploadPageImage(
  buffer: Buffer,
  opts: { bookId: string; pageId: string; pageNumber: number; artStyle: string | null },
): Promise<{ secure_url?: string }> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: `storywink/${opts.bookId}/generated`,
          public_id: `page_${opts.pageNumber}`,
          overwrite: true,
          tags: [
            `book:${opts.bookId}`,
            `page:${opts.pageId}`,
            `pageNum:${opts.pageNumber}`,
            ...(opts.artStyle ? [`style:${opts.artStyle}`] : []),
          ],
          resource_type: 'image',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result as { secure_url?: string });
        },
      )
      .end(buffer);
  });
}

/**
 * Normalizes every page render toward the title-page render. Best-effort per
 * page; logs one line per page with the measured delta. Never throws.
 */
export async function normalizeBookPalette(params: NormalizeBookPaletteParams): Promise<void> {
  const { bookId, artStyle, coverAssetId, pages, logger } = params;

  if (!paletteNormalizeEnabled()) return;

  const startedAt = Date.now();
  const overBudget = () => Date.now() - startedAt > PALETTE_BUDGET_MS;

  try {
    if (
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET ||
      !process.env.CLOUDINARY_CLOUD_NAME
    ) {
      logger.warn({ bookId }, 'Palette normalization skipped: Cloudinary not configured');
      return;
    }
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    const titlePage = pages.find(p => isTitlePage(p.assetId, coverAssetId));
    if (!titlePage?.generatedImageUrl) {
      logger.info({ bookId }, 'Palette normalization skipped: no title-page render to anchor to');
      return;
    }

    const reference = await fetchImageInput(titlePage.generatedImageUrl);
    const referenceStats = await statsForBuffer(reference.buffer);

    const targets = pages.filter(p => p.id !== titlePage.id && p.generatedImageUrl);

    let normalized = 0;
    let skipped = 0;
    for (const page of targets) {
      if (overBudget()) {
        logger.info(
          { bookId, budgetMs: PALETTE_BUDGET_MS, normalized, remaining: targets.length - normalized - skipped },
          'Palette normalization budget exhausted — skipping remaining pages',
        );
        return;
      }

      try {
        const image = await fetchImageInput(page.generatedImageUrl!);
        const pageStats = await statsForBuffer(image.buffer);
        const coefficients = computeTransferCoefficients(pageStats, referenceStats, PALETTE_STRENGTH);
        const delta = meanDelta(pageStats, referenceStats);

        if (isNearIdentity(coefficients)) {
          skipped++;
          logger.info(
            { bookId, pageNumber: page.pageNumber, meanDelta: delta },
            'Palette normalization: page already matches title palette — skipped',
          );
          continue;
        }

        const adjusted = await sharp(image.buffer)
          .removeAlpha()
          .linear([...coefficients.multipliers], [...coefficients.offsets])
          .png()
          .toBuffer();

        const uploadResult = await uploadPageImage(adjusted, {
          bookId,
          pageId: page.id,
          pageNumber: page.pageNumber,
          artStyle,
        });
        if (!uploadResult?.secure_url) {
          throw new Error('Cloudinary upload did not return a secure URL.');
        }

        // Same public_id, but Cloudinary versions the URL — persist the fresh
        // one so clients never render a stale cached original.
        await prisma.page.update({
          where: { id: page.id },
          data: { generatedImageUrl: uploadResult.secure_url },
        });

        normalized++;
        logger.info(
          {
            bookId,
            pageNumber: page.pageNumber,
            meanDelta: delta,
            multipliers: coefficients.multipliers,
            offsets: coefficients.offsets,
          },
          'Palette normalization: page nudged toward title palette',
        );
      } catch (pageError) {
        skipped++;
        logger.warn(
          {
            bookId,
            pageNumber: page.pageNumber,
            error: pageError instanceof Error ? pageError.message : 'Unknown error',
          },
          'Palette normalization failed for page — keeping original render',
        );
      }
    }

    logger.info(
      { bookId, normalized, skipped, elapsedMs: Date.now() - startedAt },
      'Palette normalization completed',
    );
  } catch (error) {
    logger.warn(
      { bookId, error: error instanceof Error ? error.message : 'Unknown error' },
      'Palette normalization failed — continuing with original renders',
    );
  }
}
