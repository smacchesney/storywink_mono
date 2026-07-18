import type { PageQCResult, CoverQCResult } from '@storywink/shared/types';
import {
  QC_BLOCKING_CLASSES,
  emptyQcClassFlags,
  type QcClass,
} from '@storywink/shared/prompts/quality-check';

/**
 * Maximum pages per QC vision call. The book-finalize QC is split into batches
 * of this size so no single call carries the whole book — the oversized-call
 * failure mode that once shipped a book with ZERO QC rows. Even distribution
 * (see `partitionQcPages`) keeps typical (even-length) books inside the 4-6
 * rubric-context window the cross-page consistency checks need. Tunable: lower
 * to 5 for a smaller per-call image load at the cost of more calls (each batch
 * re-sends the character sheets).
 */
export const QC_BATCH_MAX_PAGES = 6;

/**
 * Feedback prefix marking a QC row that records an INFRASTRUCTURE failure — the
 * scoring call threw or returned nothing — as opposed to a quality verdict. A
 * qc_error row is persisted (so the page/cover is never silently unchecked) but
 * must NEVER trigger a re-illustration requeue or a cover regen: an outage is
 * not a quality failure.
 */
export const QC_ERROR_PREFIX = 'qc_error:';

export function isQcErrorFeedback(feedback: string | null | undefined): boolean {
  return typeof feedback === 'string' && feedback.startsWith(QC_ERROR_PREFIX);
}

/**
 * Split items into batches, each at most `maxSize`, distributed as evenly as
 * possible so a book never ends on a tiny remainder batch (e.g. 8 → [4,4], not
 * [6,2]). Order is preserved. An empty input yields no batches.
 */
export function partitionQcPages<T>(items: T[], maxSize = QC_BATCH_MAX_PAGES): T[][] {
  if (maxSize < 1) throw new Error('partitionQcPages: maxSize must be >= 1');
  if (items.length === 0) return [];

  const numBatches = Math.ceil(items.length / maxSize);
  const base = Math.floor(items.length / numBatches);
  const remainder = items.length % numBatches;

  const batches: T[][] = [];
  let cursor = 0;
  for (let i = 0; i < numBatches; i++) {
    const size = base + (i < remainder ? 1 : 0);
    batches.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return batches;
}

/** The minimum a page needs to be turned into a sentinel row. */
export interface QcBatchPageInfo {
  pageNumber: number;
  pageId: string;
}

/**
 * A sentinel `PageQCResult` for a page whose batch could not be scored (call
 * threw, returned nothing, or omitted the page). Scores are placeholders — the
 * persist layer (`buildQcRows`) writes them as null on the `qc_error:` prefix.
 * `passed` is false so the page reads as "not verified", but the feedback
 * prefix keeps it out of the requeue set.
 */
export function sentinelPageResult(page: QcBatchPageInfo, message: string): PageQCResult {
  return {
    pageNumber: page.pageNumber,
    pageId: page.pageId,
    passed: false,
    issues: [],
    characterConsistencyScore: 0,
    styleConsistencyScore: 0,
    overallScore: 0,
    suggestedPromptAdditions: `${QC_ERROR_PREFIX} ${message}`,
    // Unscored page: the all-clean/null default, NOT a clean verdict. A
    // sentinel's flags never trigger a blocking-class requeue.
    classFlags: emptyQcClassFlags(),
  };
}

/**
 * A sentinel `CoverQCResult` for a cover whose isolated scoring call could not
 * run. Same contract as the page sentinel: persisted (a cover verification
 * that never ran leaves a visible record, not silence), never acted on —
 * `isQcErrorFeedback` gates the inline cover regen, so a qc_error cover
 * verdict cannot buy a re-render off garbage feedback. `titleMatches: false`
 * means "unconfirmed", not "mismatched".
 */
export function sentinelCoverResult(message: string): CoverQCResult {
  return {
    passed: false,
    titleMatches: false,
    characterConsistencyScore: 0,
    styleConsistencyScore: 0,
    overallScore: 0,
    issues: [],
    suggestedPromptAdditions: `${QC_ERROR_PREFIX} ${message}`,
  };
}

/**
 * True if any of the given blocking classes fired on this page's flags. Only
 * `true` counts as a defect — a `null` no-op class never blocks.
 */
export function hasBlockingFlag(
  result: PageQCResult,
  blockingClasses: readonly QcClass[] = QC_BLOCKING_CLASSES,
): boolean {
  return blockingClasses.some((cls) => result.classFlags[cls] === true);
}

/**
 * Page ids that must be re-illustrated. Two independent triggers, both gated
 * behind "not a qc_error sentinel" (an outage is never a quality verdict):
 *   1. a genuine score failure (`!passed`), or
 *   2. a BLOCKING defect class fired (rendered-text / intra-image-duplicate).
 *
 * `blockingClasses` defaults to `QC_BLOCKING_CLASSES` so promoting a telemetry
 * class into the gate is a one-line change to that constant — pass a custom set
 * only in tests. TELEMETRY-only class flags (missing-cast, species, hybrid,
 * prop-holder, focal-action) never appear here; they ride `qc_class_flags`.
 */
export function selectRequeuePageIds(
  pageResults: PageQCResult[],
  blockingClasses: readonly QcClass[] = QC_BLOCKING_CLASSES,
): string[] {
  return pageResults
    .filter(
      (r) =>
        !isQcErrorFeedback(r.suggestedPromptAdditions) &&
        (!r.passed || hasBlockingFlag(r, blockingClasses)),
    )
    .map((r) => r.pageId);
}

/**
 * Canonical re-render feedback for each BLOCKING class — the class-specific
 * instruction the re-illustration prompt needs when the judge's own
 * suggestedPromptAdditions is thin. Telemetry-only classes have no entry: they
 * never requeue, so they never need re-render feedback.
 */
export const QC_BLOCKING_CLASS_FEEDBACK: Partial<Record<QcClass, string>> = {
  renderedText:
    'REMOVE ALL TEXT: the illustration contains rendered letters or words (sound-effect words included). Interior art must contain NO text of any kind — the story words are added as a separate overlay.',
  intraImageDuplicate:
    'DUPLICATE CHARACTER: the same character appears more than once in this image. Draw each character exactly once.',
};

/**
 * The feedback string to attach to a requeued page. Prepends the canonical
 * text for whichever blocking classes fired (so a blocking failure always
 * carries class-specific guidance) and appends the judge's own feedback when
 * present. Returns null only when there is nothing to say.
 */
export function requeueFeedbackFor(
  result: PageQCResult,
  blockingClasses: readonly QcClass[] = QC_BLOCKING_CLASSES,
): string | null {
  const classText = blockingClasses
    .filter((cls) => result.classFlags[cls] === true)
    .map((cls) => QC_BLOCKING_CLASS_FEEDBACK[cls])
    .filter((text): text is string => Boolean(text))
    .join(' ');
  const judge = result.suggestedPromptAdditions?.trim() || '';
  const combined = [classText, judge].filter(Boolean).join(' ');
  return combined || null;
}

/**
 * What the judge was FED for one page — the context half of the telemetry
 * record. Shape-compatible with `pageFeedFor` (qc-assembly), which builds it
 * from the same helpers that build the judge's per-page context.
 */
export interface QcClassFlagFeed {
  /** The page's story text as fed (null/blank = focal-action was a no-op). */
  text: string | null;
  /** Expected cast fed to the judge (real names + species phrases). */
  cast: Array<{ name: string; species: string }>;
  /** Holder-annotated props fed (empty = prop-holder was a no-op). */
  props: string[];
  /** X13 Track L: stated mood fed (null = moodMismatch was a no-op). */
  mood: string | null;
  /** X13 Track L: composition focus fed (null = none; sharpens focalActionMismatch). */
  focus: string | null;
}

/** One searchable per-page telemetry record carrying every class flag. */
export interface QcClassFlagLog {
  event: 'qc_class_flags';
  bookId: string;
  pageId: string;
  pageNumber: number;
  qcRound: number;
  /** True when a BLOCKING class fired (this page is being re-queued). */
  blocked: boolean;
  /** True when the row is an unscored qc_error sentinel (exclude from precision stats). */
  qcError: boolean;
  /** Cast names the judge was told to expect — makes the precision-review row self-contained. */
  expectedCast: string[];
  /** Whether story text was fed (focal-action judged) on this page. */
  fedText: boolean;
  /** Whether holder-annotated props were fed (prop-holder judged) on this page. */
  fedProps: boolean;
  /** Whether a stated mood was fed (moodMismatch judged) on this page. */
  fedMood: boolean;
  renderedText: boolean;
  intraImageDuplicate: boolean;
  missingExpectedCast: boolean;
  speciesMismatch: boolean;
  characterHybrid: boolean;
  propHolderMismatch: boolean | null;
  focalActionMismatch: boolean | null;
  moodMismatch: boolean | null;
}

/**
 * Build the one-per-page `qc_class_flags` record — the dataset the promotion
 * criterion reads. Emitted for every page (sentinels included, marked
 * `qcError`) so each finalized page leaves exactly one telemetry row. Pass
 * `feed` (what the judge was fed) so a human reviewing precision never has to
 * reconstruct the page's expected cast from another table.
 */
export function buildQcClassFlagLog(params: {
  bookId: string;
  qcRound: number;
  result: PageQCResult;
  feed?: QcClassFlagFeed;
  blockingClasses?: readonly QcClass[];
}): QcClassFlagLog {
  const { bookId, qcRound, result, feed } = params;
  const blockingClasses = params.blockingClasses ?? QC_BLOCKING_CLASSES;
  const qcError = isQcErrorFeedback(result.suggestedPromptAdditions);
  const f = result.classFlags;
  return {
    event: 'qc_class_flags',
    bookId,
    pageId: result.pageId,
    pageNumber: result.pageNumber,
    qcRound,
    blocked: !qcError && hasBlockingFlag(result, blockingClasses),
    qcError,
    expectedCast: feed?.cast.map((c) => c.name) ?? [],
    fedText: Boolean(feed?.text && feed.text.trim()),
    fedProps: (feed?.props.length ?? 0) > 0,
    fedMood: Boolean(feed?.mood && feed.mood.trim()),
    renderedText: f.renderedText,
    intraImageDuplicate: f.intraImageDuplicate,
    missingExpectedCast: f.missingExpectedCast,
    speciesMismatch: f.speciesMismatch,
    characterHybrid: f.characterHybrid,
    propHolderMismatch: f.propHolderMismatch,
    focalActionMismatch: f.focalActionMismatch,
    moodMismatch: f.moodMismatch,
  };
}

/**
 * The isolated cover judge call runs on the FIRST QC round only. The single
 * cover regen it can buy is itself qcRound===0-gated, so a round-1+ cover
 * verdict is unactionable: it costs a judge call, and a variance-flipped
 * round-1 "failed cover" row would mislead naive latest-row queries. Round-0
 * behavior is unchanged.
 */
export function coverJudgeEligible(qcRound: number): boolean {
  return qcRound === 0;
}

/** What one batch's scoring call resolves to. */
export interface QcBatchOutcome {
  /** Mapped, real page results the judge returned for this batch. */
  pageResults: PageQCResult[];
}

/** One searchable per-batch telemetry record. */
export interface QcBatchLog {
  event: 'qc_batch_result';
  batchIndex: number;
  pageCount: number;
  ok: boolean;
  error?: string;
  durationMs?: number;
}

export interface RunQcBatchesResult {
  /** Exactly one entry per input page, across all batches, in batch order. */
  pageResults: PageQCResult[];
  logs: QcBatchLog[];
}

/**
 * Score every page batch, isolating failures. Guarantees exactly one
 * `PageQCResult` per input page: a batch that throws yields sentinel rows for
 * its pages instead of taking the whole book down, and a page the judge omits
 * from an otherwise-successful batch is back-filled with a sentinel too. The
 * cover is NOT batched — it gets its own isolated scoring call in the worker,
 * so a page-batch failure can never forfeit cover verification (or vice versa).
 *
 * Pure over its injected `scoreBatch` so the batch-isolation behavior is
 * testable without the OpenAI SDK. `onBatchComplete` fires per batch for
 * immediate logging.
 */
export async function runQcBatches<T extends QcBatchPageInfo>(
  batches: T[][],
  scoreBatch: (batch: T[], batchIndex: number) => Promise<QcBatchOutcome>,
  onBatchComplete?: (log: QcBatchLog) => void,
): Promise<RunQcBatchesResult> {
  const pageResults: PageQCResult[] = [];
  const logs: QcBatchLog[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchStartedAt = Date.now();
    let log: QcBatchLog;

    try {
      const outcome = await scoreBatch(batch, i);
      const byId = new Map(outcome.pageResults.map((r) => [r.pageId, r]));
      for (const page of batch) {
        const mapped = byId.get(page.pageId);
        pageResults.push(mapped ?? sentinelPageResult(page, 'no QC result returned for page'));
      }
      log = {
        event: 'qc_batch_result',
        batchIndex: i,
        pageCount: batch.length,
        ok: true,
        durationMs: Date.now() - batchStartedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      for (const page of batch) pageResults.push(sentinelPageResult(page, message));
      log = {
        event: 'qc_batch_result',
        batchIndex: i,
        pageCount: batch.length,
        ok: false,
        error: message,
        durationMs: Date.now() - batchStartedAt,
      };
    }

    logs.push(log);
    onBatchComplete?.(log);
  }

  return { pageResults, logs };
}

/** Render-time attribution stamps for one rendered image. */
export interface QcRenderMeta {
  provider: string | null;
  model: string | null;
  hadSheet: boolean;
}

/** The exact row shape persisted to `IllustrationQcResult` (zero-migration). */
export interface QcResultRow {
  bookId: string;
  pageId: string | null;
  target: 'page' | 'cover';
  qcRound: number;
  charScore: number | null;
  styleScore: number | null;
  overallScore: number | null;
  passed: boolean;
  provider: string | null;
  model: string | null;
  hadSheet: boolean;
  feedback: string | null;
}

/**
 * Builds the `IllustrationQcResult` rows for one QC run — the single place the
 * sentinel row shape is defined. qc_error results (page or cover) persist with
 * `passed: false`, ALL score fields null (the sentinel's placeholder 0s are
 * not a verdict), and the `qc_error:`-prefixed feedback. Real results keep
 * their scores. One row per page result, plus one cover row when a cover
 * verdict (real or sentinel) exists — pass `coverResult: null` when no cover
 * was in the run.
 */
export function buildQcRows(params: {
  bookId: string;
  qcRound: number;
  pageResults: PageQCResult[];
  renderMetaByPageId: Map<string, QcRenderMeta>;
  coverResult: CoverQCResult | null;
  /** The cover renderer's stamps — by convention the interior title page's. */
  coverMeta: QcRenderMeta;
}): QcResultRow[] {
  const { bookId, qcRound, pageResults, renderMetaByPageId, coverResult, coverMeta } = params;

  const rows: QcResultRow[] = pageResults.map((r) => {
    const qcErrored = isQcErrorFeedback(r.suggestedPromptAdditions);
    const meta = renderMetaByPageId.get(r.pageId);
    return {
      bookId,
      pageId: r.pageId,
      target: 'page',
      qcRound,
      charScore: qcErrored ? null : r.characterConsistencyScore,
      styleScore: qcErrored ? null : r.styleConsistencyScore,
      overallScore: qcErrored ? null : r.overallScore,
      passed: r.passed,
      provider: meta?.provider ?? null,
      model: meta?.model ?? null,
      hadSheet: meta?.hadSheet ?? false,
      feedback: r.suggestedPromptAdditions,
    };
  });

  if (coverResult) {
    const coverErrored = isQcErrorFeedback(coverResult.suggestedPromptAdditions);
    // target='cover' keeps cover rows out of page-drift stats.
    rows.push({
      bookId,
      pageId: null,
      target: 'cover',
      qcRound,
      charScore: coverErrored ? null : coverResult.characterConsistencyScore,
      styleScore: coverErrored ? null : coverResult.styleConsistencyScore,
      overallScore: coverErrored ? null : coverResult.overallScore,
      passed: coverResult.passed,
      provider: coverMeta.provider,
      model: coverMeta.model,
      hadSheet: coverMeta.hadSheet,
      feedback: coverResult.suggestedPromptAdditions,
    });
  }

  return rows;
}
