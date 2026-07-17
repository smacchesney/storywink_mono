import { Job, FlowProducer } from 'bullmq';
import * as Sentry from '@sentry/node';
import prisma from '../database/index.js';
import {
  BookFinalizeJob,
  CharacterIdentity,
  BookQCResult,
  CharacterSheetRef,
  CoverQCResult,
} from '@storywink/shared/types';
import { QUEUE_NAMES } from '@storywink/shared/constants';
import { categorizePages, isTitlePage, resolveCoverPage } from '@storywink/shared/utils';
import { createBullMQConnection } from '@storywink/shared/redis';
import OpenAI from 'openai';
import { optimizeCloudinaryUrlForVision, convertHeicToJpeg } from '@storywink/shared/utils';
import {
  createQCPrompt,
  QC_SYSTEM_PROMPT,
  QC_RESPONSE_SCHEMA,
} from '@storywink/shared/prompts/quality-check';
import { isValidStyle } from '@storywink/shared/prompts/styles';
import { trackEvent } from '@storywink/shared';
import { computeBookStatus } from '../lib/computeBookStatus.js';
import { mapQcResultsToPages, RawQcPageResult } from '../lib/qc-mapping.js';
import {
  partitionQcPages,
  runQcBatches,
  selectRequeuePageIds,
  isQcErrorFeedback,
  sentinelCoverResult,
  buildQcRows,
  requeueFeedbackFor,
  buildQcClassFlagLog,
  coverJudgeEligible,
  type QcBatchOutcome,
} from '../lib/qc-batching.js';
import { assembleQcBatchParts, pageFeedFor, type QcAssemblyPage } from '../lib/qc-assembly.js';
import { toysComeAliveEnabled } from '../lib/toys-come-alive.js';
import { characterSheetsEnabled, sheetRefsForStyle } from '../lib/character-sheets.js';
import { mergeLinkedAvatarSheets } from '../lib/avatar-sheets.js';
import {
  escalationModel,
  illustrationEscalationEnabled,
  shouldEscalate,
} from '../lib/escalation.js';
import { maybeSendReadyEmail } from '../lib/email.js';
import { normalizeBookPalette, paletteNormalizeEnabled } from '../lib/palette.js';
import { generateAndStoreCover } from '../lib/cover-generation.js';
import { fetchImageInput, resizeForReference } from '../lib/images.js';
import { ANALYSIS_MODEL } from '../config/models.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const MAX_QC_ROUNDS = 2;

/**
 * Best-effort write of Book.generationPhase — the honest-progress signal the
 * wait screen narrates from. A phase write must never fail a job.
 */
async function setGenerationPhase(bookId: string, phase: string | null): Promise<void> {
  try {
    await prisma.book.update({ where: { id: bookId }, data: { generationPhase: phase } });
  } catch (error) {
    logger.warn(
      { bookId, phase, error: error instanceof Error ? error.message : 'Unknown error' },
      'Failed to write generationPhase — continuing',
    );
  }
}

/**
 * Run quality check on all generated illustrations using OpenAI vision.
 * Returns null if QC cannot be run (no API key, no images, etc.)
 */
async function runQualityCheck(
  bookId: string,
  // QcAssemblyPage carries everything batch assembly reads: pageNumber/pageId,
  // the render URL, source (BRIDGE rubric lines), story text (focal-action),
  // and bridgeScene (scene cast + holder-annotated props).
  pages: QcAssemblyPage[],
  characterIdentity: CharacterIdentity | null,
  language: string = 'en',
  sheets: CharacterSheetRef[] = [],
  cover: { url: string; expectedTitle: string } | null = null,
): Promise<BookQCResult | null> {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn({ bookId }, 'Skipping QC: OPENAI_API_KEY not configured');
    return null;
  }

  const illustratedPages = pages.filter((p) => p.generatedImageUrl);
  if (illustratedPages.length < 2) {
    logger.info(
      { bookId, pageCount: illustratedPages.length },
      'Skipping QC: fewer than 2 illustrated pages',
    );
    return null;
  }

  logger.info(
    { bookId, pageCount: illustratedPages.length, sheetCount: sheets.length, hasCover: !!cover },
    'Running quality check on illustrations',
  );
  console.log(
    `[BookFinalize/QC] Running QC on ${illustratedPages.length} illustrations for book ${bookId}`,
  );

  // Character sheet content parts — the ground truth PREPENDED TO EVERY BATCH
  // (each batch is judged against the same sheets, so cross-batch drift shares
  // one anchor). Non-numeric labels ("REFERENCE SHEET", not "PAGE n") so they
  // can never collide with a page ordinal in the echoed results.
  const sheetParts: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string; detail: 'high' }
  > = [];
  for (const sheet of sheets) {
    sheetParts.push({
      type: 'input_text',
      text: `REFERENCE SHEET — ${sheet.name || sheet.characterId}`,
    });
    sheetParts.push({
      type: 'input_image',
      image_url: optimizeCloudinaryUrlForVision(sheet.url),
      detail: 'high',
    });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // One JSON-schema'd judge call, shared by the page batches and the isolated
  // cover call. Throws on an empty response (an infra failure, not a pass) —
  // callers catch and record a sentinel.
  const callQcJudge = async (
    contentParts: Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_image'; image_url: string; detail: 'high' }
    >,
  ): Promise<{
    passed: boolean;
    summary: string;
    coverResult?: CoverQCResult | null;
    pageResults: RawQcPageResult[];
  }> => {
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
    const rawResult = result.output_text;
    if (!rawResult) throw new Error('OpenAI QC returned empty response');
    return JSON.parse(rawResult);
  };

  // COVER: its own ISOLATED scoring call (sheets + cover only, same rubric
  // machinery) so a page-batch failure can never forfeit cover verification
  // and a cover failure can never taint the pages. Throw/empty/omitted →
  // cover sentinel, persisted like a page sentinel; the qc_error prefix keeps
  // it from ever buying a regen off garbage feedback.
  let coverResult: CoverQCResult | null = null;
  if (cover) {
    try {
      const contentParts: typeof sheetParts = [...sheetParts];
      // Non-numeric label; scored via the coverResult schema field with its
      // own rubric variant, never via pageResults.
      contentParts.push({ type: 'input_text', text: 'COVER' });
      contentParts.push({
        type: 'input_image',
        image_url: optimizeCloudinaryUrlForVision(cover.url),
        detail: 'high',
      });
      // pageCount 0: this call carries no "PAGE n" images — only the cover,
      // whose rubric section instructs the judge to fill coverResult.
      contentParts.push({
        type: 'input_text',
        text: createQCPrompt(characterIdentity, 0, language, {
          sheetCount: sheets.length,
          cover: { expectedTitle: cover.expectedTitle },
        }),
      });

      const parsed = await callQcJudge(contentParts);
      coverResult = parsed.coverResult ?? sentinelCoverResult('no cover result returned');
    } catch (err) {
      coverResult = sentinelCoverResult(err instanceof Error ? err.message : 'Unknown error');
    }

    const coverErrored = isQcErrorFeedback(coverResult.suggestedPromptAdditions);
    if (coverErrored) {
      logger.error(
        {
          bookId,
          event: 'qc_cover_result',
          ok: false,
          error: coverResult.suggestedPromptAdditions,
        },
        'QC cover call failed — sentinel recorded',
      );
    } else {
      logger.info(
        { bookId, event: 'qc_cover_result', ok: true, passed: coverResult.passed },
        'QC cover scored',
      );
    }
    console.log(
      `[BookFinalize/QC] cover: ${
        coverErrored
          ? `error — ${coverResult.suggestedPromptAdditions}`
          : coverResult.passed
            ? 'passed'
            : 'failed'
      }`,
    );
  }

  // Split the book into small batches so no single vision call carries the
  // whole book (the oversized-call failure mode that shipped a book with ZERO
  // QC rows). Each batch re-sends the sheets ground truth; batches carry
  // pages ONLY (the cover was scored above).
  const batches = partitionQcPages(illustratedPages);

  const scoreBatch = async (
    batch: typeof illustratedPages,
    batchIndex: number,
  ): Promise<QcBatchOutcome> => {
    // Pure, tested assembly shared with the proof harness: batch-local PAGE-n
    // ordinals (restart at 1), batch-local pageCount, per-page context feed
    // (expected cast with REAL names + species — intentional, the judge scores
    // appearance against the sheets; unrelated to render-time neutralization).
    const assembly = assembleQcBatchParts({
      batch,
      characterIdentity,
      language,
      sheetCount: sheets.length,
      // TOYS_COME_ALIVE_ENABLED (X13 Track T): a lively, life-sized toy is not
      // a speciesMismatch. Off → rubric byte-identical.
      toysComeAlive: toysComeAliveEnabled(),
    });
    const contentParts: typeof sheetParts = [...sheetParts, ...assembly.contentParts];

    const parsed = await callQcJudge(contentParts);

    const { mapped, unmatchedEchoes } = mapQcResultsToPages(
      parsed.pageResults,
      assembly.pageMapping,
    );
    if (unmatchedEchoes.length > 0) {
      logger.warn(
        { bookId, batchIndex, unmatchedEchoes, imageCount: assembly.pageMapping.length },
        'QC echoed page numbers matching no image label — dropped those results',
      );
    }

    return { pageResults: mapped };
  };

  // Batch failures are isolated: one throwing batch yields sentinel rows for
  // its pages (persisted, never requeued) while the other batches' real
  // results stand. Guarantees exactly one page result per illustrated page.
  const { pageResults, logs } = await runQcBatches(batches, scoreBatch, (log) => {
    if (log.ok) {
      logger.info({ bookId, ...log }, 'QC batch scored');
    } else {
      logger.error({ bookId, ...log }, 'QC batch failed — sentinel rows recorded');
    }
    console.log(
      `[BookFinalize/QC] batch ${log.batchIndex} (${log.pageCount} pages): ${
        log.ok ? 'ok' : `error — ${log.error}`
      }`,
    );
  });

  // Genuine quality failures only — qc_error sentinels are excluded so an
  // outage never re-illustrates a page.
  const failedPageIds = selectRequeuePageIds(pageResults);
  const sentinelCount = pageResults.filter((r) =>
    isQcErrorFeedback(r.suggestedPromptAdditions),
  ).length;
  const batchesFailed = logs.filter((l) => !l.ok).length;

  const bookQCResult: BookQCResult = {
    // A book "passes" only with no genuine failures AND no unverified
    // (sentinel) pages. Sentinels never requeue (excluded from failedPageIds),
    // so an all-sentinel book still ships — visibly unverified, not silently
    // unchecked.
    passed: failedPageIds.length === 0 && sentinelCount === 0,
    qcRound: 0, // Will be set by caller
    pageResults,
    failedPageIds,
    summary: `${failedPageIds.length} genuine failure(s), ${sentinelCount} unverified page(s) across ${batches.length} batch(es) (${batchesFailed} batch error(s)).`,
    // From the isolated cover call: real verdict, or a qc_error sentinel when
    // that call failed. Null only when no cover was in this QC run.
    coverResult,
  };

  logger.info(
    {
      bookId,
      passed: bookQCResult.passed,
      failedCount: failedPageIds.length,
      sentinelCount,
      totalChecked: pageResults.length,
      batches: batches.length,
      batchesFailed,
      summary: bookQCResult.summary,
    },
    'QC check completed',
  );

  console.log(`[BookFinalize/QC] QC result for book ${bookId}:`);
  console.log(`  - Passed: ${bookQCResult.passed}`);
  console.log(
    `  - Failed pages: ${failedPageIds.length}/${pageResults.length} (unverified: ${sentinelCount})`,
  );
  console.log(`  - Summary: ${bookQCResult.summary}`);

  for (const pr of pageResults) {
    if (!pr.passed) {
      const errored = isQcErrorFeedback(pr.suggestedPromptAdditions);
      console.log(
        `  - Page ${pr.pageNumber} ${errored ? 'UNVERIFIED (qc_error)' : 'FAILED'} (char: ${pr.characterConsistencyScore}, style: ${pr.styleConsistencyScore}, overall: ${pr.overallScore})`,
      );
      console.log(`    Issues: ${pr.issues.join('; ')}`);
      if (pr.suggestedPromptAdditions) {
        console.log(`    Feedback: ${pr.suggestedPromptAdditions.substring(0, 200)}`);
      }
    }
  }

  return bookQCResult;
}

/**
 * Cover QC's single regeneration round: re-render the cover in-process with
 * the cover-targeted QC feedback, the character sheets, and the approved
 * interior title-page render as references. Non-fatal by design — a failed
 * regen keeps the existing cover (an imperfect cover beats none).
 */
async function regenerateCoverFromQc(
  book: {
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
  },
  sheets: CharacterSheetRef[],
  coverResult: CoverQCResult,
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

export async function processBookFinalize(job: Job<BookFinalizeJob>) {
  const { bookId, userId } = job.data;
  const qcRound = job.data.qcRound || 0;

  logger.info({ bookId, userId, jobId: job.id, qcRound }, 'Starting book finalization');
  console.log(
    `[BookFinalize] Starting finalization for book ${bookId} (job: ${job.id}, qcRound: ${qcRound})`,
  );

  try {
    // Get book with all pages
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        pages: {
          orderBy: { pageNumber: 'asc' },
        },
      },
    });

    if (!book) {
      throw new Error('Book not found');
    }

    // Check completion status
    const { storyPages, coverPages } = categorizePages(book.pages, book.coverAssetId);

    const pagesWithText = book.pages.filter((p: any) => p.text && p.text.trim().length > 0);
    const storyPagesWithText = storyPages.filter((p: any) => p.text && p.text.trim().length > 0);
    const pagesWithIllustrations = book.pages.filter((p: any) => p.generatedImageUrl);
    const pagesWithFailedModeration = book.pages.filter(
      (p: any) => p.moderationStatus === 'FAILED',
    );

    const totalPages = book.pages.length;
    const textComplete = storyPagesWithText.length === storyPages.length;
    const illustrationsComplete = pagesWithIllustrations.length === totalPages;

    logger.info(
      {
        bookId,
        totalPages,
        coverPages: coverPages.length,
        storyPages: storyPages.length,
        pagesWithText: pagesWithText.length,
        storyPagesWithText: storyPagesWithText.length,
        pagesWithIllustrations: pagesWithIllustrations.length,
        pagesWithFailedModeration: pagesWithFailedModeration.length,
        textComplete,
        illustrationsComplete,
        qcRound,
      },
      'Book completion status analysis',
    );

    console.log(`[BookFinalize] Book ${bookId} analysis:`);
    console.log(
      `  - Total Pages: ${totalPages} (${coverPages.length} cover, ${storyPages.length} story)`,
    );
    console.log(`  - Story Pages with Text: ${storyPagesWithText.length}/${storyPages.length}`);
    console.log(`  - Pages with Illustrations: ${pagesWithIllustrations.length}/${totalPages}`);
    console.log(`  - Text Complete: ${textComplete}`);
    console.log(`  - Illustrations Complete: ${illustrationsComplete}`);

    // Detailed page analysis
    console.log(`[BookFinalize] Detailed page analysis:`);
    book.pages.forEach((page: any) => {
      const isActualTitlePage = isTitlePage(page.assetId, book.coverAssetId);
      console.log(`  - Page ${page.pageNumber}:`);
      console.log(`    - ID: ${page.id}`);
      console.log(`    - Asset ID: ${page.assetId}`);
      console.log(`    - Cover Asset ID: ${book.coverAssetId}`);
      console.log(`    - Is Title Page (DB): ${page.isTitlePage}`);
      console.log(`    - Is Title Page (Logic): ${isActualTitlePage}`);
      console.log(`    - Has Text: ${!!page.text} (${page.text?.length || 0} chars)`);
      console.log(`    - Has Illustration: ${!!page.generatedImageUrl}`);
      console.log(`    - Moderation Status: ${page.moderationStatus || 'N/A'}`);
    });

    const finalStatus = computeBookStatus(book.pages, book.coverAssetId);

    if (finalStatus === 'COMPLETED' && !textComplete && illustrationsComplete) {
      console.log(
        `[BookFinalize] All illustrations complete, treating as COMPLETED despite missing text on some pages`,
      );
    }

    // ========================================================================
    // QC CHECK: Run quality check on completed illustrations
    // Only runs if: status would be COMPLETED, we haven't exceeded max QC
    // rounds, AND this wasn't a scoped run (single-page reillustrate must
    // never cascade regenerations onto pages the user didn't touch).
    // ========================================================================
    const isScopedRun = Boolean(job.data.scopedPageIds?.length);
    if (isScopedRun) {
      logger.info(
        { bookId, scopedPageIds: job.data.scopedPageIds },
        'Scoped illustration run — skipping book-wide QC',
      );
    }
    if (finalStatus === 'COMPLETED' && qcRound < MAX_QC_ROUNDS && !isScopedRun) {
      try {
        // Get character identity from book record
        const characterIdentity = book.characterIdentity as CharacterIdentity | null;

        const qcPages = book.pages.map((p: any) => ({
          pageNumber: p.pageNumber,
          pageId: p.id,
          generatedImageUrl: p.generatedImageUrl,
          source: p.source,
          text: p.text,
          bridgeScene: p.bridgeScene,
        }));

        // CHARACTER_SHEETS_ENABLED: validated sheets become QC's ground
        // truth, and the cover joins the QC pass with its own rubric
        // variant (painted title expected, must match book.title exactly).
        const sheetsEnabled = characterSheetsEnabled();
        // X6c/X6d: QC re-renders must keep the SAME reference stack the
        // original renders conditioned on. The flow snapshots it into this
        // job's data; the DB re-read is only a fallback for pre-snapshot jobs
        // (a mid-flight "draw again" could otherwise swap the identity anchor
        // between rounds).
        const sheets =
          job.data.characterSheets ??
          (await mergeLinkedAvatarSheets({
            bookId,
            userId,
            artStyle: book.artStyle,
            bookType: book.bookType,
            base: sheetsEnabled
              ? sheetRefsForStyle(book.characterReferences, book.artStyle, characterIdentity)
              : [],
            logger,
          })) ??
          [];
        // Judge ground truth comes from the render-time lastRenderHadSheet
        // stamps, NOT from Book.characterReferences at finalize time:
        // ensureCharacterSheets' budget-expiry path persists sheets in the
        // background AFTER a run was already enqueued sheetless, so the
        // DB-derived refs can describe sheets the judged renders never
        // received. Sheets still flow into the QC re-render jobs and the
        // cover regen below — those subsequent renders DO receive them and
        // stamp their own rows true.
        const anyRenderHadSheet = book.pages.some(
          (p: any) => p.generatedImageUrl && p.lastRenderHadSheet,
        );
        const sheetsForJudge = anyRenderHadSheet ? sheets : [];
        // Avatar books get cover QC unconditionally: their cover is a pure
        // generation (no photo behind it) judged against the avatar sheets.
        // ROUND 0 ONLY (coverJudgeEligible): the one cover regen this verdict
        // can buy is itself qcRound===0-gated, so a round-1+ cover judge call
        // would be pure cost — and a variance-flipped round-1 "failed cover"
        // row would mislead naive latest-row queries.
        const coverForQc =
          coverJudgeEligible(qcRound) &&
          (sheetsEnabled || book.bookType === 'AVATAR_STORY') &&
          book.coverImageUrl &&
          book.title
            ? { url: book.coverImageUrl, expectedTitle: book.title }
            : null;

        // The endgame is real work — say so instead of sitting on a full bar.
        await setGenerationPhase(bookId, 'finishing');

        const qcResult = await runQualityCheck(
          bookId,
          qcPages,
          characterIdentity,
          book.language,
          sheetsForJudge,
          coverForQc,
        );

        // C4 TELEMETRY: one searchable qc_class_flags record per page — the
        // dataset the promotion criterion reads to decide when a telemetry-only
        // class earns a place in QC_BLOCKING_CLASSES. Emitted before persist so
        // a persist failure never costs the telemetry; sentinels included
        // (marked qcError) so every finalized page leaves exactly one row.
        // Each record carries the judge's FED context (expected cast names,
        // text/props presence) so the precision review reads one dataset.
        if (qcResult) {
          const qcPageById = new Map(qcPages.map((p) => [p.pageId, p]));
          for (const pr of qcResult.pageResults) {
            const fedPage = qcPageById.get(pr.pageId);
            logger.info(
              buildQcClassFlagLog({
                bookId,
                qcRound,
                result: pr,
                ...(fedPage ? { feed: pageFeedFor(characterIdentity, fedPage) } : {}),
              }),
              'QC per-page class flags',
            );
          }
        }

        // Persist every scored image (passes included — the pass distribution
        // is the drift baseline). Provider/model come from the render-time
        // stamps; finalize cannot infer them itself.
        if (qcResult) {
          try {
            const renderMetaByPageId = new Map(
              book.pages.map((p: any) => [
                p.id,
                {
                  provider: p.lastRenderProvider ?? null,
                  model: p.lastRenderModel ?? null,
                  hadSheet: p.lastRenderHadSheet ?? false,
                },
              ]),
            );
            // The cover is rendered by the same job (and provider) as the
            // interior title page, so its attribution comes from the title
            // page's render-time stamps (shared cover-page resolver).
            const titlePage = resolveCoverPage(
              book.pages as { assetId: string | null; isTitlePage?: boolean }[],
              book.coverAssetId,
              book.bookType,
            );
            // buildQcRows is the single place the row shape (and the qc_error
            // sentinel's NULL scores) is defined — unit-tested directly.
            await prisma.illustrationQcResult.createMany({
              data: buildQcRows({
                bookId,
                qcRound,
                pageResults: qcResult.pageResults,
                renderMetaByPageId,
                // Real verdict OR qc_error sentinel — a cover that was in the
                // run always leaves a row, even when its call failed.
                coverResult: coverForQc ? (qcResult.coverResult ?? null) : null,
                // The cover is rendered by the same job as the interior title
                // page, so its attribution follows the title page's stamps.
                coverMeta: {
                  provider: (titlePage as any)?.lastRenderProvider ?? null,
                  model: (titlePage as any)?.lastRenderModel ?? null,
                  hadSheet: (titlePage as any)?.lastRenderHadSheet ?? false,
                },
              }),
            });
          } catch (persistError: any) {
            logger.warn(
              { bookId, qcRound, error: persistError.message },
              'Failed to persist IllustrationQcResult rows — continuing',
            );
          }
        }

        // Cover QC regen: exactly ONE round, taken only on the first QC pass
        // (qcRound === 0) so a book run can never re-buy the cover twice.
        // Inline (not re-queued): cover failure never blocks or requeues
        // pages, and the finalize lock is long enough for one render.
        // Skipped when the TITLE PAGE itself is being requeued below — its
        // successful re-render regenerates the cover anyway, and this regen
        // would be overwritten uncorrected (one wasted render).
        const titlePageRequeued = Boolean(
          qcResult &&
          !qcResult.passed &&
          book.pages.some((p: any) => p.isTitlePage && qcResult.failedPageIds.includes(p.id)),
        );
        // A qc_error cover sentinel never buys a regen: the cover was not
        // judged, so there is no quality verdict (and no usable feedback) to
        // regenerate from — the sentinel row is the record that QC didn't run.
        if (
          coverForQc &&
          qcResult?.coverResult &&
          !qcResult.coverResult.passed &&
          !isQcErrorFeedback(qcResult.coverResult.suggestedPromptAdditions) &&
          qcRound === 0 &&
          !titlePageRequeued
        ) {
          await regenerateCoverFromQc(book, sheets, qcResult.coverResult);
        }

        if (qcResult && !qcResult.passed && qcResult.failedPageIds.length > 0) {
          const nextRound = qcRound + 1;
          qcResult.qcRound = nextRound;

          // ESCALATION LADDER (ILLUSTRATION_ESCALATION_ENABLED): the final
          // re-render round is the book's last chance, so it runs on the
          // stronger escalation model instead of re-rolling the same dice.
          // Marker rides in job data; keep-old-image semantics are untouched
          // (an escalated failure still leaves the previous render in place).
          const escalationModelId = shouldEscalate(
            nextRound,
            MAX_QC_ROUNDS,
            illustrationEscalationEnabled(),
          )
            ? escalationModel()
            : null;

          logger.info(
            {
              bookId,
              qcRound: nextRound,
              failedPages: qcResult.failedPageIds.length,
              ...(escalationModelId ? { escalationModel: escalationModelId } : {}),
            },
            'QC failed — re-queuing failed pages for re-illustration',
          );

          console.log(
            `[BookFinalize/QC] QC round ${nextRound} failed for book ${bookId} — re-queuing ${qcResult.failedPageIds.length} pages`,
          );

          // Build re-illustration jobs for failed pages
          const failedPagesData = book.pages
            .filter((p: any) => qcResult.failedPageIds.includes(p.id))
            .map((p: any) => {
              const pageResult = qcResult.pageResults.find((r) => r.pageId === p.id);
              return {
                page: p,
                // Blocking-class failures carry class-specific re-render guidance
                // (rendered-text / duplicate) prepended to the judge's own notes.
                qcFeedback: pageResult ? requeueFeedbackFor(pageResult) : null,
              };
            });

          // Mark failed pages for re-generation but KEEP the round-1 image:
          // the re-render overwrites generatedImageUrl only on successful
          // upload (the Cloudinary public_id page_{n} already overwrites), so
          // a failed round-2 render leaves an imperfect image instead of none.
          for (const { page } of failedPagesData) {
            await prisma.page.update({
              where: { id: page.id },
              data: {
                moderationStatus: 'PENDING',
                moderationReason: null,
              },
            });
          }

          // Update book status back to ILLUSTRATING and persist qcRound.
          // Phase 'polishing' keeps the wait screen honest: this is a
          // quality re-render round, not the first pass starting over.
          await prisma.book.update({
            where: { id: bookId },
            data: { status: 'ILLUSTRATING', qcRound: nextRound, generationPhase: 'polishing' },
          });

          // Create FlowProducer flow for re-illustration
          const pageChildren = failedPagesData.map(({ page, qcFeedback }) => ({
            name: `generate-illustration-${bookId}-p${page.pageNumber}-qc${nextRound}`,
            queueName: QUEUE_NAMES.ILLUSTRATION_GENERATION,
            data: {
              userId,
              bookId,
              pageId: page.id,
              pageNumber: page.pageNumber,
              text: page.text,
              artStyle: book.artStyle,
              bookTitle: book.title,
              isTitlePage: page.isTitlePage,
              illustrationNotes: page.illustrationNotes,
              originalImageUrl: page.originalImageUrl,
              characterIdentity,
              // Same language as the extraction-path flow: without it a ja
              // book's QC re-render would build an 'en' prompt (Latin sound
              // effects) that the ja QC rubric then fails again.
              language: book.language,
              // Re-renders must keep the same reference stack the original
              // render had, or the QC round re-rolls sheetless.
              ...(sheets.length ? { characterSheets: sheets } : {}),
              qcRound: nextRound,
              qcFeedback,
              // Final-round escalation: the illustration worker honors this
              // model override for exactly this one re-render.
              ...(escalationModelId ? { escalation: { model: escalationModelId } } : {}),
            },
            opts: {
              attempts: 5,
              backoff: { type: 'exponential' as const, delay: 10000 },
              removeOnComplete: { count: 1000 },
              removeOnFail: { count: 5000 },
              failParentOnFailure: false,
              removeDependencyOnFailure: true,
            },
          }));

          const flowProducer = new FlowProducer({ connection: createBullMQConnection() });

          try {
            const flow = await flowProducer.add({
              name: `finalize-book-${bookId}-qc${nextRound}`,
              queueName: QUEUE_NAMES.BOOK_FINALIZE,
              // The sheet snapshot rides forward so round 2 judges and
              // re-renders against the same stack round 1 used.
              data: {
                bookId,
                userId,
                qcRound: nextRound,
                ...(sheets.length ? { characterSheets: sheets } : {}),
              },
              opts: {
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 500 },
              },
              children: pageChildren,
            });

            logger.info(
              {
                bookId,
                qcRound: nextRound,
                reIllustrateCount: pageChildren.length,
                flowJobId: flow.job.id,
              },
              'Created QC re-illustration flow',
            );

            console.log(
              `[BookFinalize/QC] Re-illustration flow created for book ${bookId} (QC round ${nextRound})`,
            );
            console.log(`  - Re-illustrating: ${pageChildren.length} pages`);
            console.log(`  - Flow Job ID: ${flow.job.id}`);

            // One event per escalated page — the telemetry that says whether
            // the ladder earns its cost (trackEvent never throws).
            if (escalationModelId) {
              for (const { page } of failedPagesData) {
                await trackEvent(
                  prisma,
                  {
                    name: 'qc_escalated',
                    userId,
                    bookId,
                    props: { pageId: page.id, model: escalationModelId },
                  },
                  logger,
                );
              }
            }
          } finally {
            await flowProducer.close();
          }

          // Return early — the new finalize job will handle completion
          return {
            success: true,
            status: 'QC_REQUEUED',
            qcRound: nextRound,
            failedPages: qcResult.failedPageIds.length,
          };
        }

        // QC passed or couldn't run — proceed with normal completion
        if (qcResult?.passed) {
          console.log(
            `[BookFinalize/QC] QC passed for book ${bookId} — proceeding with completion`,
          );
        }
      } catch (qcError: any) {
        // QC failure should not block book completion
        logger.error(
          {
            bookId,
            error: qcError.message,
            stack: qcError.stack,
          },
          'QC check failed — proceeding with normal completion',
        );
        console.error(
          `[BookFinalize/QC] QC error for book ${bookId}: ${qcError.message} — proceeding with completion`,
        );
      }
    } else if (finalStatus === 'COMPLETED' && qcRound >= MAX_QC_ROUNDS) {
      console.log(
        `[BookFinalize/QC] Max QC rounds (${MAX_QC_ROUNDS}) reached for book ${bookId} — accepting current quality`,
      );
    }

    // PALETTE_NORMALIZE_ENABLED: with the QC gate cleared and no requeue
    // pending, nudge every page render toward the title-page palette (40%
    // channel-mean/std transfer). Full runs only — a scoped run's siblings
    // were already normalized, and re-normalizing compounds the transfer.
    // Never fatal; hard 60s budget inside.
    if (finalStatus === 'COMPLETED' && !isScopedRun && paletteNormalizeEnabled()) {
      await setGenerationPhase(bookId, 'finishing');
      await normalizeBookPalette({
        bookId,
        artStyle: book.artStyle,
        coverAssetId: book.coverAssetId,
        bookType: book.bookType,
        pages: book.pages.map((p: any) => ({
          id: p.id,
          pageNumber: p.pageNumber,
          assetId: p.assetId,
          generatedImageUrl: p.generatedImageUrl,
          isTitlePage: p.isTitlePage,
        })),
        logger,
      });
    }

    // Update book status (reset qcRound on completion so it's clean for
    // future retries; clear the phase — the book is terminal now)
    await prisma.book.update({
      where: { id: bookId },
      data: {
        status: finalStatus,
        qcRound: 0,
        generationPhase: null,
        updatedAt: new Date(),
      },
    });

    // Create notification for book completion. These strings are the stored
    // fallback (the bell renders localized copy from `type` client-side);
    // keep them in the gentle librarian voice — the bell deep-links to the
    // book, where retry/fix-up lives, so "tap" stays true.
    const notificationMessages = {
      COMPLETED: {
        title: `"${book.title}" is ready!`,
        message: `Every page of "${book.title}" is illustrated and waiting for you.`,
      },
      PARTIAL: {
        title: `"${book.title}" is almost ready`,
        message: `A couple of pages need a quick fix — tap to finish up.`,
      },
      FAILED: {
        title: `"${book.title}" hit a snag`,
        message: `Let's give it another try — tap to retry.`,
      },
    };

    const notification = notificationMessages[finalStatus];
    await prisma.notification.create({
      data: {
        userId,
        bookId,
        type: `BOOK_${finalStatus}`,
        title: notification.title,
        message: notification.message,
      },
    });
    logger.info(
      { bookId, userId, type: `BOOK_${finalStatus}` },
      'Created notification for book completion',
    );

    // READY_EMAIL_ENABLED: one email per book (COMPLETED and PARTIAL
    // variants; FAILED never mails). Idempotent via an AppEvent guard and
    // never throws — email trouble must not fail the finalize job.
    await maybeSendReadyEmail({
      bookId,
      userId,
      status: finalStatus,
      title: book.title,
      language: book.language || 'en',
      logger,
    });

    await trackEvent(
      prisma,
      {
        name: 'book_finalized',
        userId,
        bookId,
        props: {
          status: finalStatus,
          qcRound,
          failedPages: book.pages.filter(
            (p: any) =>
              !p.generatedImageUrl ||
              p.moderationStatus === 'FAILED' ||
              p.moderationStatus === 'FLAGGED',
          ).length,
        },
      },
      logger,
    );

    logger.info(
      {
        bookId,
        finalStatus,
        totalPages,
        pagesWithText: pagesWithText.length,
        pagesWithIllustrations: pagesWithIllustrations.length,
        qcRound,
        jobId: job.id,
      },
      'Book finalization completed',
    );

    console.log(
      `[BookFinalize] Finalization completed for book ${bookId} with status: ${finalStatus}`,
    );

    return {
      success: true,
      status: finalStatus,
      totalPages,
      pagesWithText: pagesWithText.length,
      pagesWithIllustrations: pagesWithIllustrations.length,
      qcRound,
    };
  } catch (error: any) {
    logger.error({ bookId, error: error.message, qcRound }, 'Book finalization failed');
    Sentry.captureException(error, {
      tags: { worker: 'book-finalize', jobId: job.id },
      extra: { bookId, qcRound },
    });

    // Update book status to failed
    await prisma.book
      .update({
        where: { id: bookId },
        data: { status: 'FAILED', generationPhase: null },
      })
      .catch(() => {}); // Ignore errors when updating status

    throw error;
  }
}
