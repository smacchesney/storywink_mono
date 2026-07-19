/**
 * X17 A1 — the finalize composed-cover step. Books created with
 * COVER_COMPOSED_ENABLED have no title page, so the cover renders HERE,
 * after page QC, composed from the whole day: hero photos (fidelity), the
 * cast's validated sheets (identity), one QC-passing interior render (style
 * anchor), and Book.themeLine (composition brief).
 *
 * Ladder: composed render → 5s pause → composed retry → legacy
 * photo-anchored cover from hero #1 → give up. Every path is NON-FATAL: with
 * no cover, the UI falls back to the first page render and print falls back
 * via resolveCoverImageUrl. A rendered cover is judged by the isolated cover
 * QC call (row persisted, target 'cover'); a genuine failure buys exactly
 * ONE feedback-guided regen — round-0 parity with coverRegenEligible.
 *
 * Keyed off BOOK STATE (composedCoverEligible), never off the flag. Never
 * throws. Idempotent: an existing coverImageUrl skips the step entirely.
 */

import OpenAI from 'openai';
import type { Logger } from 'pino';
import prisma from '../database/index.js';
import type { CharacterIdentity, CoverQCResult } from '@storywink/shared/types';
import { optimizeCloudinaryUrlForVision, convertHeicToJpeg } from '@storywink/shared/utils';
import { isValidStyle, StyleKey } from '@storywink/shared/prompts/styles';
import {
  createQCPrompt,
  QC_SYSTEM_PROMPT,
  QC_RESPONSE_SCHEMA,
} from '@storywink/shared/prompts/quality-check';
import { ANALYSIS_MODEL, ANALYSIS_OPENAI_TIMEOUT_MS } from '../config/models.js';
import { generateAndStoreCover, type CoverGenerationOptions } from './cover-generation.js';
import { fetchImageInput, resizeForReference } from './images.js';
import type { IllustrationImageInput } from './illustrators/index.js';
import { getIllustrator } from './illustrators/index.js';
import { buildQcRows, isQcErrorFeedback, sentinelCoverResult } from './qc-batching.js';
import { sheetCapFor, sheetRefsForStyle } from './character-sheets.js';
import { ensembleMemberIds } from './ensemble.js';
import {
  composedCoverEligible,
  resolveHeroAssetIds,
  selectStyleAnchorPage,
  starredCharacterIds,
} from './composed-cover.helpers.js';

/** Pause between the two composed attempts (queue-backoff base-delay idiom). */
export const COMPOSED_COVER_RETRY_DELAY_MS = 5000;

export async function runComposedCoverStep(params: {
  bookId: string;
  userId: string;
  logger: Logger;
}): Promise<'composed' | 'legacy' | 'skipped' | 'failed'> {
  const { bookId, logger } = params;
  try {
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        pages: {
          orderBy: { pageNumber: 'asc' },
          include: { asset: { select: { url: true, thumbnailUrl: true } } },
        },
      },
    });
    if (!book || !composedCoverEligible(book)) return 'skipped';
    if (!isValidStyle(book.artStyle!)) {
      logger.warn({ bookId, artStyle: book.artStyle }, 'Composed cover skipped: invalid art style');
      return 'skipped';
    }

    const identity = book.characterIdentity as CharacterIdentity | null;
    const memberIds = ensembleMemberIds(book);
    const starredIds = starredCharacterIds(book);

    // Hero photos — fidelity references, vision-normalized like every render.
    const heroIds = resolveHeroAssetIds(book.coverHeroAssetIds, book.pages);
    const heroImages: IllustrationImageInput[] = [];
    for (const assetId of heroIds) {
      const page = book.pages.find((p) => p.assetId === assetId);
      const url = page?.asset?.url || page?.asset?.thumbnailUrl;
      if (!url) continue;
      try {
        heroImages.push(
          await fetchImageInput(optimizeCloudinaryUrlForVision(convertHeicToJpeg(url))),
        );
      } catch (heroError) {
        logger.warn(
          {
            bookId,
            assetId,
            error: heroError instanceof Error ? heroError.message : 'Unknown error',
          },
          'Composed cover: hero photo fetch failed — continuing without it',
        );
      }
    }
    if (heroImages.length === 0) {
      logger.warn({ bookId }, 'Composed cover: no hero photo resolvable — giving up (non-fatal)');
      return 'failed';
    }

    // Cast sheets — identity references, ensemble-aware cap.
    const sheets = sheetRefsForStyle(
      book.characterReferences,
      book.artStyle,
      identity,
      sheetCapFor(memberIds),
    );
    const sheetRefs: IllustrationImageInput[] = [];
    for (const sheet of sheets) {
      try {
        sheetRefs.push(await fetchImageInput(optimizeCloudinaryUrlForVision(sheet.url)));
      } catch (sheetError) {
        logger.warn(
          {
            bookId,
            characterId: sheet.characterId,
            error: sheetError instanceof Error ? sheetError.message : 'Unknown error',
          },
          'Composed cover: sheet fetch failed — continuing without it',
        );
      }
    }

    // Style anchor — the QC-passing interior render starring the cast.
    const qcRows = await prisma.illustrationQcResult.findMany({
      where: { bookId, target: 'page' },
      select: { pageId: true, overallScore: true, passed: true, qcRound: true },
    });
    const anchorPage = selectStyleAnchorPage(
      book.pages.map((p) => ({
        pageId: p.id,
        pageNumber: p.pageNumber,
        generatedImageUrl: p.generatedImageUrl,
      })),
      qcRows,
      starredIds,
      identity,
    );
    let interiorRenderRef: IllustrationImageInput | null = null;
    if (anchorPage?.generatedImageUrl) {
      try {
        const interior = await fetchImageInput(
          optimizeCloudinaryUrlForVision(anchorPage.generatedImageUrl),
        );
        interiorRenderRef = await resizeForReference(interior.buffer);
      } catch (anchorError) {
        logger.warn(
          { bookId, error: anchorError instanceof Error ? anchorError.message : 'Unknown error' },
          'Composed cover: style-anchor fetch failed — continuing without it',
        );
      }
    }

    const baseOpts = {
      bookId,
      styleKey: book.artStyle as StyleKey,
      bookTitle: book.title ?? null,
      // No title page exists — the theme (or the parent's brief) is the scene text.
      pageText: book.themeLine || book.eventSummary || '',
      illustrationNotes: null,
      language: book.language || 'en',
      characterIdentity: identity,
      pageNumber: 0, // no page row behind a composed cover
      characterSheetRefs: sheetRefs,
      interiorRenderRef,
      logger,
    };
    const composedOpts = (qcFeedback: string | null): CoverGenerationOptions => ({
      ...baseOpts,
      contentImage: heroImages[0],
      extraHeroRefs: heroImages.slice(1),
      coverComposition: { themeLine: book.themeLine, heroPhotoCount: heroImages.length },
      qcFeedback,
    });

    // Ladder: composed → pause → composed retry → legacy photo-anchored.
    let mode: 'composed' | 'legacy' | null = null;
    let coverUrl: string | null = null;
    for (let attempt = 0; attempt < 2 && !coverUrl; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, COMPOSED_COVER_RETRY_DELAY_MS));
        const result = await generateAndStoreCover(composedOpts(null));
        if ('coverUrl' in result) {
          coverUrl = result.coverUrl;
          mode = 'composed';
        } else {
          logger.warn({ bookId, attempt, reason: result.blockedReason }, 'Composed cover blocked');
        }
      } catch (renderError) {
        logger.warn(
          {
            bookId,
            attempt,
            error: renderError instanceof Error ? renderError.message : 'Unknown error',
          },
          'Composed cover render failed',
        );
      }
    }
    if (!coverUrl) {
      // Legacy fallback: hero #1 anchors a plain photo cover (today's prompt).
      try {
        const result = await generateAndStoreCover({
          ...baseOpts,
          contentImage: heroImages[0],
          qcFeedback: null,
        });
        if ('coverUrl' in result) {
          coverUrl = result.coverUrl;
          mode = 'legacy';
        }
      } catch (legacyError) {
        logger.warn(
          { bookId, error: legacyError instanceof Error ? legacyError.message : 'Unknown error' },
          'Composed cover: legacy fallback render failed',
        );
      }
    }
    if (!coverUrl || !mode) {
      logger.error(
        { bookId },
        'Composed-cover ladder exhausted — book ships coverless (non-fatal)',
      );
      return 'failed';
    }
    logger.info({ bookId, mode, coverUrl }, 'Composed-cover step rendered a cover');

    // Cover QC — the same isolated call + rubric finalize uses for legacy
    // covers; the row persists either way (pass, fail, or sentinel).
    const scored = await judgeComposedCover({ book, coverUrl, sheets, identity, logger });
    if (scored) {
      await persistCoverQcRow({
        bookId,
        coverResult: scored,
        hadSheet: sheetRefs.length > 0,
        logger,
      });
      if (
        scored.passed === false &&
        !isQcErrorFeedback(scored.suggestedPromptAdditions) &&
        mode === 'composed'
      ) {
        // Exactly ONE feedback-guided regen (legacy round-0 parity). A blocked
        // or failed regen keeps the first composed cover — imperfect beats none.
        try {
          const regen = await generateAndStoreCover(composedOpts(scored.suggestedPromptAdditions));
          if ('coverUrl' in regen) {
            logger.info(
              { bookId, coverUrl: regen.coverUrl },
              'Composed cover regenerated after QC failure',
            );
          } else {
            logger.warn(
              { bookId, reason: regen.blockedReason },
              'Composed-cover regen blocked — keeping first render',
            );
          }
        } catch (regenError) {
          logger.warn(
            { bookId, error: regenError instanceof Error ? regenError.message : 'Unknown error' },
            'Composed-cover regen failed — keeping first render',
          );
        }
      }
    }
    return mode;
  } catch (error) {
    logger.error(
      { bookId, error: error instanceof Error ? error.message : 'Unknown error' },
      'runComposedCoverStep failed (non-fatal)',
    );
    return 'failed';
  }
}

/**
 * Isolated cover judge — the same content-part shape as finalize's cover
 * call (sheets ground truth, "COVER" label, pageCount 0 → coverResult).
 * Never throws: every failure resolves to a qc_error sentinel, which never
 * buys a regen. Null when no judge can run (no key / untitled book).
 */
async function judgeComposedCover(params: {
  book: { title: string | null; language: string | null };
  coverUrl: string;
  sheets: { characterId: string; name: string | null; url: string }[];
  identity: CharacterIdentity | null;
  logger: Logger;
}): Promise<CoverQCResult | null> {
  const { book, coverUrl, sheets, identity } = params;
  if (!process.env.OPENAI_API_KEY || !book.title) return null;
  try {
    const contentParts: Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_image'; image_url: string; detail: 'high' }
    > = [];
    for (const sheet of sheets) {
      contentParts.push({
        type: 'input_text',
        text: `REFERENCE SHEET — ${sheet.name || sheet.characterId}`,
      });
      contentParts.push({
        type: 'input_image',
        image_url: optimizeCloudinaryUrlForVision(sheet.url),
        detail: 'high',
      });
    }
    contentParts.push({ type: 'input_text', text: 'COVER' });
    contentParts.push({
      type: 'input_image',
      image_url: optimizeCloudinaryUrlForVision(coverUrl),
      detail: 'high',
    });
    contentParts.push({
      type: 'input_text',
      text: createQCPrompt(identity, 0, book.language || 'en', {
        sheetCount: sheets.length,
        cover: { expectedTitle: book.title },
      }),
    });

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: ANALYSIS_OPENAI_TIMEOUT_MS,
    });
    const result = await openai.responses.create({
      model: ANALYSIS_MODEL,
      instructions: QC_SYSTEM_PROMPT,
      input: [{ role: 'user', content: contentParts }],
      text: {
        format: {
          type: 'json_schema',
          name: 'qc_response',
          strict: true,
          schema: QC_RESPONSE_SCHEMA as Record<string, unknown>,
        },
      },
    });
    if (!result.output_text) throw new Error('OpenAI cover QC returned empty response');
    const parsed = JSON.parse(result.output_text) as { coverResult?: CoverQCResult | null };
    return parsed.coverResult ?? sentinelCoverResult('no cover result returned');
  } catch (err) {
    return sentinelCoverResult(err instanceof Error ? err.message : 'Unknown error');
  }
}

/** One IllustrationQcResult row, target 'cover', via the tested row builder.
 * Attribution comes from the running illustrator (the composed cover has no
 * title page to inherit stamps from). Telemetry only — never throws. */
async function persistCoverQcRow(params: {
  bookId: string;
  coverResult: CoverQCResult;
  hadSheet: boolean;
  logger: Logger;
}): Promise<void> {
  const { bookId, coverResult, hadSheet, logger } = params;
  try {
    const illustrator = getIllustrator();
    await prisma.illustrationQcResult.createMany({
      data: buildQcRows({
        bookId,
        qcRound: 0,
        pageResults: [],
        renderMetaByPageId: new Map(),
        coverResult,
        coverMeta: { provider: illustrator.name, model: illustrator.modelId, hadSheet },
      }),
    });
  } catch (persistError) {
    logger.warn(
      { bookId, error: persistError instanceof Error ? persistError.message : 'Unknown error' },
      'Composed cover: QC row persist failed — continuing',
    );
  }
}
