import type { PageQCResult, CoverQCResult } from '@storywink/shared/types';

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
 * Page ids that must be re-illustrated: genuine quality failures only. A
 * qc_error sentinel (infra failure) is deliberately excluded — the finalize
 * requeue keys off `!passed`, and an outage is not a quality verdict.
 */
export function selectRequeuePageIds(pageResults: PageQCResult[]): string[] {
  return pageResults
    .filter((r) => !r.passed && !isQcErrorFeedback(r.suggestedPromptAdditions))
    .map((r) => r.pageId);
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
    let log: QcBatchLog;

    try {
      const outcome = await scoreBatch(batch, i);
      const byId = new Map(outcome.pageResults.map((r) => [r.pageId, r]));
      for (const page of batch) {
        const mapped = byId.get(page.pageId);
        pageResults.push(mapped ?? sentinelPageResult(page, 'no QC result returned for page'));
      }
      log = { event: 'qc_batch_result', batchIndex: i, pageCount: batch.length, ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      for (const page of batch) pageResults.push(sentinelPageResult(page, message));
      log = {
        event: 'qc_batch_result',
        batchIndex: i,
        pageCount: batch.length,
        ok: false,
        error: message,
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
