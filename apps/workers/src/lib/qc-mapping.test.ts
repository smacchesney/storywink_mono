import { describe, it, expect } from 'vitest';
import { mapQcResultsToPages, RawQcPageResult, QcPageRef } from './qc-mapping.js';

function rawResult(overrides: Partial<RawQcPageResult> = {}): RawQcPageResult {
  return {
    pageNumber: 1,
    passed: true,
    characterConsistencyScore: 8,
    styleConsistencyScore: 8,
    overallScore: 8,
    issues: [],
    suggestedPromptAdditions: null,
    ...overrides,
  };
}

describe('mapQcResultsToPages', () => {
  it('treats the echo as a 1-based presentation ordinal, not a DB pageNumber', () => {
    // DB pages 1, 2, 4 are illustrated (page 3 was skipped), so presentation
    // ordinal 3 is DB page 4 — matching the echo against Page.pageNumber
    // would silently hit the wrong page.
    const pageMapping: QcPageRef[] = [
      { pageNumber: 1, pageId: 'page-a' },
      { pageNumber: 2, pageId: 'page-b' },
      { pageNumber: 4, pageId: 'page-c' },
    ];

    const { mapped, unmatchedEchoes } = mapQcResultsToPages(
      [rawResult({ pageNumber: 3, passed: false })],
      pageMapping,
    );

    expect(unmatchedEchoes).toEqual([]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].pageId).toBe('page-c');
    expect(mapped[0].pageNumber).toBe(4);
    expect(mapped[0].passed).toBe(false);
  });

  it('survives the judge reordering its results', () => {
    const pageMapping: QcPageRef[] = [
      { pageNumber: 1, pageId: 'page-a' },
      { pageNumber: 2, pageId: 'page-b' },
      { pageNumber: 3, pageId: 'page-c' },
    ];

    const { mapped } = mapQcResultsToPages(
      [
        rawResult({ pageNumber: 3, overallScore: 3, passed: false }),
        rawResult({ pageNumber: 1, overallScore: 9 }),
        rawResult({ pageNumber: 2, overallScore: 7 }),
      ],
      pageMapping,
    );

    // Index-based mapping (the old bug) would attribute score 3 to page-a.
    expect(mapped.find((r) => r.pageId === 'page-c')?.overallScore).toBe(3);
    expect(mapped.find((r) => r.pageId === 'page-a')?.overallScore).toBe(9);
    expect(mapped.find((r) => r.pageId === 'page-b')?.overallScore).toBe(7);
  });

  it('drops out-of-range and non-integer echoes and reports them', () => {
    const pageMapping: QcPageRef[] = [
      { pageNumber: 1, pageId: 'page-a' },
      { pageNumber: 2, pageId: 'page-b' },
    ];

    const { mapped, unmatchedEchoes } = mapQcResultsToPages(
      [
        rawResult({ pageNumber: 0 }),
        rawResult({ pageNumber: 5 }),
        rawResult({ pageNumber: 1.5 }),
        rawResult({ pageNumber: 2 }),
      ],
      pageMapping,
    );

    expect(mapped).toHaveLength(1);
    expect(mapped[0].pageId).toBe('page-b');
    expect(unmatchedEchoes).toEqual([0, 5, 1.5]);
  });

  it('carries scores, issues, and feedback through unchanged', () => {
    const pageMapping: QcPageRef[] = [{ pageNumber: 7, pageId: 'page-x' }];

    const { mapped } = mapQcResultsToPages(
      [
        rawResult({
          pageNumber: 1,
          passed: false,
          characterConsistencyScore: 4,
          styleConsistencyScore: 6,
          overallScore: 5,
          issues: ['HAIR COLOR WRONG'],
          suggestedPromptAdditions: 'HAIR COLOR WRONG: must be black.',
        }),
      ],
      pageMapping,
    );

    expect(mapped[0]).toEqual({
      pageNumber: 7,
      pageId: 'page-x',
      passed: false,
      issues: ['HAIR COLOR WRONG'],
      characterConsistencyScore: 4,
      styleConsistencyScore: 6,
      overallScore: 5,
      suggestedPromptAdditions: 'HAIR COLOR WRONG: must be black.',
    });
  });
});
