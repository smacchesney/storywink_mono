import { describe, it, expect } from 'vitest';
import type { PageQCResult, CoverQCResult, QcClassFlags } from '@storywink/shared/types';
import { emptyQcClassFlags } from '@storywink/shared/prompts/quality-check';
import {
  QC_BATCH_MAX_PAGES,
  QC_ERROR_PREFIX,
  isQcErrorFeedback,
  partitionQcPages,
  sentinelPageResult,
  sentinelCoverResult,
  selectRequeuePageIds,
  hasBlockingFlag,
  requeueFeedbackFor,
  buildQcClassFlagLog,
  coverJudgeEligible,
  coverRegenEligible,
  runQcBatches,
  buildQcRows,
  type QcBatchPageInfo,
  type QcRenderMeta,
} from './qc-batching.js';

function flags(overrides: Partial<QcClassFlags> = {}): QcClassFlags {
  return { ...emptyQcClassFlags(), ...overrides };
}

/**
 * The pathological combo pinned in LOCKSTEP by selectRequeuePageIds and
 * buildQcClassFlagLog: a qc_error sentinel that (impossibly, but defensively)
 * ALSO carries a blocking class flag. Both derivations must treat it as an
 * outage — never blocked, never requeued.
 */
function pathologicalSentinel(): PageQCResult {
  const s = sentinelPageResult({ pageNumber: 1, pageId: 'errored' }, 'boom');
  s.classFlags = flags({ renderedText: true });
  return s;
}

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
    classFlags: emptyQcClassFlags(),
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

  it('gives a page sentinel the all-clean/null classFlags default (unjudged, never blocking)', () => {
    const s = sentinelPageResult({ pageNumber: 4, pageId: 'page-4' }, 'boom');
    expect(s.classFlags).toEqual(emptyQcClassFlags());
    expect(hasBlockingFlag(s)).toBe(false);
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

  it('requeues a blocking-class flag (rendered-text) even when the judge marked the page passed', () => {
    const results = [
      realResult({ pageId: 'texty', passed: true, classFlags: flags({ renderedText: true }) }),
      realResult({
        pageId: 'dupe',
        passed: true,
        classFlags: flags({ intraImageDuplicate: true }),
      }),
      realResult({ pageId: 'clean', passed: true }),
    ];
    expect(selectRequeuePageIds(results)).toEqual(['texty', 'dupe']);
  });

  it('does NOT requeue telemetry-only class flags (missing-cast, species, hybrid, prop, focal)', () => {
    const results = [
      realResult({
        pageId: 'miss',
        passed: true,
        classFlags: flags({ missingExpectedCast: true }),
      }),
      realResult({ pageId: 'species', passed: true, classFlags: flags({ speciesMismatch: true }) }),
      realResult({ pageId: 'hybrid', passed: true, classFlags: flags({ characterHybrid: true }) }),
      realResult({ pageId: 'prop', passed: true, classFlags: flags({ propHolderMismatch: true }) }),
      realResult({
        pageId: 'focal',
        passed: true,
        classFlags: flags({ focalActionMismatch: true }),
      }),
    ];
    expect(selectRequeuePageIds(results)).toEqual([]);
  });

  it('never requeues a qc_error sentinel even if a blocking flag were somehow set', () => {
    expect(selectRequeuePageIds([pathologicalSentinel()])).toEqual([]);
  });

  it('the promotion constant drives the split: pass species into the blocking set → it requeues', () => {
    const results = [
      realResult({ pageId: 'species', passed: true, classFlags: flags({ speciesMismatch: true }) }),
      realResult({ pageId: 'clean', passed: true }),
    ];
    // Default posture: species is telemetry-only.
    expect(selectRequeuePageIds(results)).toEqual([]);
    // Promote species by passing it as a blocking class — one-line change in prod.
    expect(
      selectRequeuePageIds(results, ['renderedText', 'intraImageDuplicate', 'speciesMismatch']),
    ).toEqual(['species']);
  });
});

describe('requeueFeedbackFor', () => {
  it('prepends class-specific text for a blocking class and appends the judge feedback', () => {
    const r = realResult({
      pageId: 'p',
      passed: false,
      classFlags: flags({ renderedText: true }),
      suggestedPromptAdditions: 'HAIR COLOR WRONG: must be black.',
    });
    const fb = requeueFeedbackFor(r)!;
    expect(fb).toContain('REMOVE ALL TEXT');
    expect(fb).toContain('HAIR COLOR WRONG: must be black.');
    expect(fb.indexOf('REMOVE ALL TEXT')).toBeLessThan(fb.indexOf('HAIR COLOR'));
  });

  it('names each blocking class that fired', () => {
    const r = realResult({
      pageId: 'p',
      passed: false,
      classFlags: flags({ renderedText: true, intraImageDuplicate: true }),
      suggestedPromptAdditions: null,
    });
    const fb = requeueFeedbackFor(r)!;
    expect(fb).toContain('REMOVE ALL TEXT');
    expect(fb).toContain('DUPLICATE CHARACTER');
  });

  it('adds NO class text for a plain score failure with only telemetry flags', () => {
    const r = realResult({
      pageId: 'p',
      passed: false,
      classFlags: flags({ speciesMismatch: true }),
      suggestedPromptAdditions: 'SKIN TONE DRIFT: too pale.',
    });
    expect(requeueFeedbackFor(r)).toBe('SKIN TONE DRIFT: too pale.');
  });

  it('returns null when there is nothing to say', () => {
    expect(requeueFeedbackFor(realResult({ passed: false, suggestedPromptAdditions: null }))).toBe(
      null,
    );
  });
});

describe('buildQcClassFlagLog', () => {
  it('emits one structured record with every class flag and a blocked marker', () => {
    const log = buildQcClassFlagLog({
      bookId: 'book-1',
      qcRound: 1,
      result: realResult({
        pageId: 'page-2',
        pageNumber: 2,
        passed: true,
        classFlags: flags({ renderedText: true, missingExpectedCast: true }),
      }),
    });
    expect(log).toEqual({
      event: 'qc_class_flags',
      bookId: 'book-1',
      pageId: 'page-2',
      pageNumber: 2,
      qcRound: 1,
      blocked: true, // rendered-text is a blocking class
      qcError: false,
      expectedCast: [],
      fedText: false,
      fedProps: false,
      fedMood: false,
      renderedText: true,
      intraImageDuplicate: false,
      missingExpectedCast: true,
      speciesMismatch: false,
      characterHybrid: false,
      propHolderMismatch: null,
      moodMismatch: null,
      focalActionMismatch: null,
    });
  });

  it('carries the fed context so the precision-review dataset is self-contained', () => {
    const log = buildQcClassFlagLog({
      bookId: 'b',
      qcRound: 0,
      result: realResult({ pageId: 'p', classFlags: flags({ missingExpectedCast: true }) }),
      feed: {
        text: 'Kai splashed into the puddle.',
        cast: [
          { name: 'Kai', species: 'a young boy' },
          { name: 'Grypho', species: 'a green toy crocodile' },
        ],
        props: ['lantern held by Kai'],
        mood: 'gleeful',
        focus: 'Kai splashing into the puddle',
      },
    });
    expect(log.expectedCast).toEqual(['Kai', 'Grypho']);
    expect(log.fedText).toBe(true);
    expect(log.fedProps).toBe(true);
    expect(log.fedMood).toBe(true);
  });

  it('reports fedText/fedProps false for empty text and holder-less props', () => {
    const log = buildQcClassFlagLog({
      bookId: 'b',
      qcRound: 0,
      result: realResult({ pageId: 'p' }),
      feed: { text: '   ', cast: [], props: [], mood: '  ', focus: null },
    });
    expect(log.expectedCast).toEqual([]);
    expect(log.fedText).toBe(false);
    expect(log.fedProps).toBe(false);
    expect(log.fedMood).toBe(false);
  });

  it('marks a telemetry-only defect as NOT blocked', () => {
    const log = buildQcClassFlagLog({
      bookId: 'b',
      qcRound: 0,
      result: realResult({ pageId: 'p', classFlags: flags({ speciesMismatch: true }) }),
    });
    expect(log.blocked).toBe(false);
    expect(log.speciesMismatch).toBe(true);
  });

  it('marks a qc_error sentinel row (excluded from precision stats, never blocked)', () => {
    const log = buildQcClassFlagLog({
      bookId: 'b',
      qcRound: 0,
      result: sentinelPageResult({ pageNumber: 5, pageId: 'page-5' }, 'boom'),
    });
    expect(log.qcError).toBe(true);
    expect(log.blocked).toBe(false);
    expect(log.pageId).toBe('page-5');
  });

  it('LOCKSTEP with the requeue selector on the pathological sentinel-with-blocking-flag', () => {
    const p = pathologicalSentinel();
    // Log side: outage, never blocked — the flag itself is still recorded as data.
    const log = buildQcClassFlagLog({ bookId: 'b', qcRound: 0, result: p });
    expect(log.qcError).toBe(true);
    expect(log.blocked).toBe(false);
    expect(log.renderedText).toBe(true);
    // Requeue side: the same fixture is excluded from the requeue set.
    expect(selectRequeuePageIds([p])).toEqual([]);
  });
});

describe('coverJudgeEligible', () => {
  it('runs the isolated cover judge on the first QC round', () => {
    expect(coverJudgeEligible(0)).toBe(true);
  });

  it('skips it on round 1+ (regen is round-0-gated, so the verdict is unactionable)', () => {
    expect(coverJudgeEligible(1)).toBe(false);
    expect(coverJudgeEligible(2)).toBe(false);
  });
});

describe('coverRegenEligible (X15: regen rides the requeue flow)', () => {
  const failedCover = (): CoverQCResult =>
    realCoverResult({
      passed: false,
      titleMatches: false,
      issues: ['title corrupted'],
      suggestedPromptAdditions: 'Fix the title lettering',
    });

  const base = {
    coverJudged: true,
    coverResult: failedCover(),
    qcRound: 0,
    titlePageRequeued: false,
  };

  it('buys the regen on a genuine round-0 cover failure', () => {
    expect(coverRegenEligible(base)).toBe(true);
  });

  it('never regens from a qc_error sentinel (cover was not judged)', () => {
    expect(coverRegenEligible({ ...base, coverResult: sentinelCoverResult('boom') })).toBe(false);
  });

  it('never regens on round 1+ (exactly-once rule)', () => {
    expect(coverRegenEligible({ ...base, qcRound: 1 })).toBe(false);
  });

  it('skips when the title page itself is requeued (its re-render rebuys the cover)', () => {
    expect(coverRegenEligible({ ...base, titlePageRequeued: true })).toBe(false);
  });

  it('skips a passed cover and a missing/unjudged cover', () => {
    expect(coverRegenEligible({ ...base, coverResult: { ...failedCover(), passed: true } })).toBe(
      false,
    );
    expect(coverRegenEligible({ ...base, coverResult: null })).toBe(false);
    expect(coverRegenEligible({ ...base, coverJudged: false })).toBe(false);
  });
});

describe('runQcBatches', () => {
  const okOutcome = (batch: QcBatchPageInfo[]) => ({
    pageResults: batch.map((p) =>
      realResult({ pageId: p.pageId, pageNumber: p.pageNumber, passed: true }),
    ),
  });

  it('scores batches CONCURRENTLY while keeping page results in input batch order (X15)', async () => {
    const batches = [
      [pageInfo(1), pageInfo(2)],
      [pageInfo(3), pageInfo(4)],
      [pageInfo(5), pageInfo(6)],
    ];

    let inFlight = 0;
    let maxInFlight = 0;
    const { pageResults, logs } = await runQcBatches(batches, async (batch, index) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Reversed delays: batch 0 resolves LAST — order stability must come
      // from aggregation, not from completion order.
      await new Promise((resolve) => setTimeout(resolve, (batches.length - index) * 10));
      inFlight--;
      return okOutcome(batch);
    });

    expect(maxInFlight).toBeGreaterThan(1);
    expect(pageResults.map((r) => r.pageId)).toEqual([
      'page-1',
      'page-2',
      'page-3',
      'page-4',
      'page-5',
      'page-6',
    ]);
    expect(logs.map((l) => l.batchIndex)).toEqual([0, 1, 2]);
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

    // Telemetry: one row per batch, marking ok/error (+ per-batch duration).
    expect(logs).toEqual([
      {
        event: 'qc_batch_result',
        batchIndex: 0,
        pageCount: 3,
        ok: true,
        durationMs: expect.any(Number),
      },
      {
        event: 'qc_batch_result',
        batchIndex: 1,
        pageCount: 3,
        ok: false,
        error: 'rate limited',
        durationMs: expect.any(Number),
      },
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
