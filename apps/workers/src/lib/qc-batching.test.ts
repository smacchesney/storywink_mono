import { describe, it, expect } from 'vitest';
import type { PageQCResult, CoverQCResult } from '@storywink/shared/types';
import {
  QC_BATCH_MAX_PAGES,
  QC_ERROR_PREFIX,
  isQcErrorFeedback,
  partitionQcPages,
  sentinelPageResult,
  sentinelCoverResult,
  selectRequeuePageIds,
  runQcBatches,
  buildQcRows,
  type QcBatchPageInfo,
  type QcRenderMeta,
} from './qc-batching.js';

function realResult(overrides: Partial<PageQCResult> = {}): PageQCResult {
  return {
    pageNumber: 1,
    pageId: 'page-1',
    passed: true,
    issues: [],
    characterConsistencyScore: 8,
    styleConsistencyScore: 8,
    overallScore: 8,
    suggestedPromptAdditions: null,
    ...overrides,
  };
}

function realCoverResult(overrides: Partial<CoverQCResult> = {}): CoverQCResult {
  return {
    passed: true,
    titleMatches: true,
    characterConsistencyScore: 7,
    styleConsistencyScore: 7,
    overallScore: 7,
    issues: [],
    suggestedPromptAdditions: null,
    ...overrides,
  };
}

const pageInfo = (n: number): QcBatchPageInfo => ({ pageNumber: n, pageId: `page-${n}` });

describe('partitionQcPages', () => {
  it('keeps a small book in one batch', () => {
    expect(partitionQcPages([1, 2], 6)).toEqual([[1, 2]]);
    expect(partitionQcPages([1, 2, 3, 4, 5, 6], 6)).toEqual([[1, 2, 3, 4, 5, 6]]);
  });

  it('splits an even book into even batches (never a tiny remainder)', () => {
    expect(partitionQcPages([1, 2, 3, 4, 5, 6, 7, 8], 6)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
    expect(partitionQcPages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 6)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
    ]);
    expect(partitionQcPages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 6)).toEqual([
      [1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12],
    ]);
  });

  it('never exceeds maxSize and stays within the 4-6 window for common lengths', () => {
    for (const n of [8, 10, 12, 14, 16, 18, 20, 24]) {
      const batches = partitionQcPages(
        Array.from({ length: n }, (_, i) => i),
        6,
      );
      expect(batches.flat()).toHaveLength(n);
      for (const b of batches) {
        expect(b.length).toBeLessThanOrEqual(6);
        expect(b.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('preserves order and total count', () => {
    const items = Array.from({ length: 13 }, (_, i) => i);
    const batches = partitionQcPages(items, 6);
    expect(batches.flat()).toEqual(items);
    // 13 → ceil(13/6)=3 batches, base 4, remainder 1 → [5,4,4]
    expect(batches.map((b) => b.length)).toEqual([5, 4, 4]);
  });

  it('returns no batches for an empty input', () => {
    expect(partitionQcPages([], 6)).toEqual([]);
  });

  it('defaults maxSize to QC_BATCH_MAX_PAGES', () => {
    const batches = partitionQcPages(Array.from({ length: 12 }, (_, i) => i));
    expect(batches.every((b) => b.length <= QC_BATCH_MAX_PAGES)).toBe(true);
  });

  it('rejects a nonsensical maxSize', () => {
    expect(() => partitionQcPages([1, 2], 0)).toThrow();
  });
});

describe('isQcErrorFeedback / sentinelPageResult / sentinelCoverResult', () => {
  it('recognizes the qc_error prefix', () => {
    expect(isQcErrorFeedback('qc_error: boom')).toBe(true);
    expect(isQcErrorFeedback(`${QC_ERROR_PREFIX} anything`)).toBe(true);
  });

  it('does not treat genuine feedback or null as qc_error', () => {
    expect(isQcErrorFeedback(null)).toBe(false);
    expect(isQcErrorFeedback(undefined)).toBe(false);
    expect(isQcErrorFeedback('HAIR COLOR WRONG: must be black')).toBe(false);
  });

  it('builds a page sentinel with false pass, placeholder scores, and prefixed feedback', () => {
    const s = sentinelPageResult({ pageNumber: 4, pageId: 'page-4' }, 'request timed out');
    expect(s.pageId).toBe('page-4');
    expect(s.pageNumber).toBe(4);
    expect(s.passed).toBe(false);
    expect(s.suggestedPromptAdditions).toBe('qc_error: request timed out');
    expect(isQcErrorFeedback(s.suggestedPromptAdditions)).toBe(true);
  });

  it('builds a cover sentinel: unverified (not passed, title unconfirmed), prefixed feedback', () => {
    const s = sentinelCoverResult('cover call exploded');
    expect(s.passed).toBe(false);
    expect(s.titleMatches).toBe(false);
    expect(s.suggestedPromptAdditions).toBe('qc_error: cover call exploded');
    expect(isQcErrorFeedback(s.suggestedPromptAdditions)).toBe(true);
  });
});

describe('selectRequeuePageIds', () => {
  it('requeues genuine failures only', () => {
    const results = [
      realResult({ pageId: 'ok', passed: true }),
      realResult({ pageId: 'bad', passed: false, suggestedPromptAdditions: 'SKIN TONE DRIFT' }),
    ];
    expect(selectRequeuePageIds(results)).toEqual(['bad']);
  });

  it('excludes qc_error sentinels even though they are not passed', () => {
    const results = [
      sentinelPageResult(pageInfo(1), 'boom'),
      sentinelPageResult(pageInfo(2), 'boom'),
    ];
    expect(selectRequeuePageIds(results)).toEqual([]);
  });

  it('when a qc_error row and a genuine fail coexist, only the genuine fail requeues', () => {
    const results = [
      realResult({
        pageId: 'genuine',
        passed: false,
        suggestedPromptAdditions: 'ANATOMY: six fingers',
      }),
      sentinelPageResult({ pageNumber: 2, pageId: 'errored' }, 'rate limited'),
      realResult({ pageId: 'fine', passed: true }),
    ];
    expect(selectRequeuePageIds(results)).toEqual(['genuine']);
  });
});

describe('runQcBatches', () => {
  const okOutcome = (batch: QcBatchPageInfo[]) => ({
    pageResults: batch.map((p) =>
      realResult({ pageId: p.pageId, pageNumber: p.pageNumber, passed: true }),
    ),
  });

  it('one batch throws: sentinels for exactly that batch, real results for the others', async () => {
    const batches = [
      [pageInfo(1), pageInfo(2), pageInfo(3)],
      [pageInfo(4), pageInfo(5), pageInfo(6)],
    ];

    const { pageResults, logs } = await runQcBatches(batches, async (batch, index) => {
      if (index === 1) throw new Error('rate limited');
      return okOutcome(batch);
    });

    // Batch 0 pages are real, batch 1 pages are sentinels.
    const byId = new Map(pageResults.map((r) => [r.pageId, r]));
    expect(pageResults).toHaveLength(6);
    expect(isQcErrorFeedback(byId.get('page-1')!.suggestedPromptAdditions)).toBe(false);
    expect(byId.get('page-1')!.passed).toBe(true);
    for (const id of ['page-4', 'page-5', 'page-6']) {
      expect(byId.get(id)!.passed).toBe(false);
      expect(byId.get(id)!.suggestedPromptAdditions).toBe('qc_error: rate limited');
    }

    // The errored batch is NOT requeued; genuine fails would be — here none.
    expect(selectRequeuePageIds(pageResults)).toEqual([]);

    // Telemetry: one row per batch, marking ok/error.
    expect(logs).toEqual([
      { event: 'qc_batch_result', batchIndex: 0, pageCount: 3, ok: true },
      { event: 'qc_batch_result', batchIndex: 1, pageCount: 3, ok: false, error: 'rate limited' },
    ]);
  });

  it('all batches fail: every page gets a sentinel, no requeues', async () => {
    const batches = [
      [pageInfo(1), pageInfo(2)],
      [pageInfo(3), pageInfo(4)],
    ];

    const captured: string[] = [];
    const { pageResults } = await runQcBatches(
      batches,
      async () => {
        throw new Error('QC outage');
      },
      (log) => captured.push(`${log.batchIndex}:${log.ok}`),
    );

    expect(pageResults).toHaveLength(4);
    expect(pageResults.every((r) => r.passed === false)).toBe(true);
    expect(pageResults.every((r) => isQcErrorFeedback(r.suggestedPromptAdditions))).toBe(true);
    expect(selectRequeuePageIds(pageResults)).toEqual([]);
    expect(captured).toEqual(['0:false', '1:false']);
  });

  it('a qc_error batch and a genuinely-failed page coexist: only the genuine page requeues', async () => {
    const batches = [
      [pageInfo(1), pageInfo(2)], // one genuine fail here
      [pageInfo(3), pageInfo(4)], // whole batch errors
    ];

    const { pageResults } = await runQcBatches(batches, async (batch, index) => {
      if (index === 1) throw new Error('boom');
      return {
        pageResults: batch.map((p) =>
          realResult({
            pageId: p.pageId,
            pageNumber: p.pageNumber,
            passed: p.pageId !== 'page-2',
            suggestedPromptAdditions: p.pageId === 'page-2' ? 'STYLE DRIFT' : null,
          }),
        ),
      };
    });

    expect(selectRequeuePageIds(pageResults)).toEqual(['page-2']);
  });

  it('back-fills a page the judge omits from an otherwise-successful batch', async () => {
    const batches = [[pageInfo(1), pageInfo(2), pageInfo(3)]];

    const { pageResults } = await runQcBatches(batches, async (batch) => ({
      // Judge returns results for pages 1 and 3 only — page 2 is dropped.
      pageResults: [
        realResult({ pageId: batch[0].pageId, pageNumber: batch[0].pageNumber }),
        realResult({ pageId: batch[2].pageId, pageNumber: batch[2].pageNumber }),
      ],
    }));

    expect(pageResults).toHaveLength(3);
    const page2 = pageResults.find((r) => r.pageId === 'page-2')!;
    expect(page2.passed).toBe(false);
    expect(isQcErrorFeedback(page2.suggestedPromptAdditions)).toBe(true);
    // A back-filled omission still never requeues.
    expect(selectRequeuePageIds(pageResults)).toEqual([]);
  });
});

describe('buildQcRows (the exact shape persisted to IllustrationQcResult)', () => {
  const meta = (over: Partial<QcRenderMeta> = {}): QcRenderMeta => ({
    provider: 'gemini',
    model: 'gemini-3.1-flash-image-preview',
    hadSheet: true,
    ...over,
  });

  const base = {
    bookId: 'book-1',
    qcRound: 0,
    coverResult: null,
    coverMeta: meta(),
  };

  it('writes a qc_error page row with passed=false, ALL scores null, prefixed feedback', () => {
    const rows = buildQcRows({
      ...base,
      pageResults: [sentinelPageResult({ pageNumber: 3, pageId: 'page-3' }, 'rate limited')],
      renderMetaByPageId: new Map([['page-3', meta()]]),
    });

    expect(rows).toEqual([
      {
        bookId: 'book-1',
        pageId: 'page-3',
        target: 'page',
        qcRound: 0,
        charScore: null,
        styleScore: null,
        overallScore: null,
        passed: false,
        provider: 'gemini',
        model: 'gemini-3.1-flash-image-preview',
        hadSheet: true,
        feedback: 'qc_error: rate limited',
      },
    ]);
  });

  it('keeps real scores on a genuinely scored page row (pass and fail alike)', () => {
    const rows = buildQcRows({
      ...base,
      pageResults: [
        realResult({ pageId: 'page-1', pageNumber: 1 }),
        realResult({
          pageId: 'page-2',
          pageNumber: 2,
          passed: false,
          characterConsistencyScore: 3,
          styleConsistencyScore: 5,
          overallScore: 4,
          suggestedPromptAdditions: 'HAIR COLOR WRONG: must be black',
        }),
      ],
      renderMetaByPageId: new Map([
        ['page-1', meta()],
        ['page-2', meta({ provider: 'openai', model: 'gpt-image-2', hadSheet: false })],
      ]),
    });

    expect(rows[0]).toMatchObject({
      pageId: 'page-1',
      target: 'page',
      charScore: 8,
      styleScore: 8,
      overallScore: 8,
      passed: true,
      feedback: null,
    });
    expect(rows[1]).toMatchObject({
      pageId: 'page-2',
      charScore: 3,
      styleScore: 5,
      overallScore: 4,
      passed: false,
      provider: 'openai',
      model: 'gpt-image-2',
      hadSheet: false,
      feedback: 'HAIR COLOR WRONG: must be black',
    });
  });

  it('defaults missing render meta to nulls / false rather than dropping the row', () => {
    const rows = buildQcRows({
      ...base,
      pageResults: [realResult({ pageId: 'page-9', pageNumber: 9 })],
      renderMetaByPageId: new Map(),
    });

    expect(rows[0]).toMatchObject({
      pageId: 'page-9',
      provider: null,
      model: null,
      hadSheet: false,
    });
  });

  it('writes a cover SENTINEL row: pageId null, target cover, null scores, qc_error feedback', () => {
    const rows = buildQcRows({
      ...base,
      pageResults: [],
      renderMetaByPageId: new Map(),
      coverResult: sentinelCoverResult('cover call exploded'),
      coverMeta: meta({ provider: 'openai', model: 'gpt-image-2' }),
    });

    expect(rows).toEqual([
      {
        bookId: 'book-1',
        pageId: null,
        target: 'cover',
        qcRound: 0,
        charScore: null,
        styleScore: null,
        overallScore: null,
        passed: false,
        provider: 'openai',
        model: 'gpt-image-2',
        hadSheet: true,
        feedback: 'qc_error: cover call exploded',
      },
    ]);
  });

  it('writes a real cover row with its scores intact', () => {
    const rows = buildQcRows({
      ...base,
      pageResults: [],
      renderMetaByPageId: new Map(),
      coverResult: realCoverResult({
        passed: false,
        titleMatches: false,
        suggestedPromptAdditions: 'TITLE GARBLED: reads "Corel", must read "Coral"',
      }),
    });

    expect(rows).toEqual([
      {
        bookId: 'book-1',
        pageId: null,
        target: 'cover',
        qcRound: 0,
        charScore: 7,
        styleScore: 7,
        overallScore: 7,
        passed: false,
        provider: 'gemini',
        model: 'gemini-3.1-flash-image-preview',
        hadSheet: true,
        feedback: 'TITLE GARBLED: reads "Corel", must read "Coral"',
      },
    ]);
  });

  it('writes no cover row when there was no cover in the QC run', () => {
    const rows = buildQcRows({
      ...base,
      pageResults: [realResult({ pageId: 'page-1', pageNumber: 1 })],
      renderMetaByPageId: new Map([['page-1', meta()]]),
      coverResult: null,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe('page');
  });
});
