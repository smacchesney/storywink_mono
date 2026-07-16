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
 * batch call threw or returned nothing — as opposed to a quality verdict. A
 * qc_error row is persisted (so the page is never silently unchecked) but must
 * NEVER trigger a re-illustration requeue: an outage is not a quality failure.
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
 * persist layer writes them as null on the `qc_error:` prefix. `passed` is
 * false so the page reads as "not verified", but the feedback prefix keeps it
 * out of the requeue set.
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
  /** Cover verdict — only meaningful for the batch that carried the cover. */
  coverResult?: CoverQCResult | null;
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
  coverResult: CoverQCResult | null;
  logs: QcBatchLog[];
}

/**
 * Score every batch, isolating failures. Guarantees exactly one `PageQCResult`
 * per input page: a batch that throws yields sentinel rows for its pages
 * instead of taking the whole book down, and a page the judge omits from an
 * otherwise-successful batch is back-filled with a sentinel too. The cover
 * rides batch 0 only (it must be scored once, not once per batch).
 *
 * Pure over its injected `scoreBatch` so the batch-isolation behavior is
 * testable without the OpenAI SDK. `onBatchComplete` fires per batch for
 * immediate logging.
 */
export async function runQcBatches<T extends QcBatchPageInfo>(
  batches: T[][],
  scoreBatch: (batch: T[], batchIndex: number, includeCover: boolean) => Promise<QcBatchOutcome>,
  onBatchComplete?: (log: QcBatchLog) => void,
): Promise<RunQcBatchesResult> {
  const pageResults: PageQCResult[] = [];
  const logs: QcBatchLog[] = [];
  let coverResult: CoverQCResult | null = null;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const includeCover = i === 0;
    let log: QcBatchLog;

    try {
      const outcome = await scoreBatch(batch, i, includeCover);
      const byId = new Map(outcome.pageResults.map((r) => [r.pageId, r]));
      for (const page of batch) {
        const mapped = byId.get(page.pageId);
        pageResults.push(mapped ?? sentinelPageResult(page, 'no QC result returned for page'));
      }
      if (includeCover) coverResult = outcome.coverResult ?? null;
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

  return { pageResults, coverResult, logs };
}
