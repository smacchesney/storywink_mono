import { describe, it, expect } from 'vitest';
import {
  FRESH_WINDOW_MS,
  STRIP_FACES_AT_MS,
  STRIP_READING_AT_MS,
  allPagesAnalyzed,
  arrivalStripPhase,
  initialStripPhase,
  isFreshBook,
  stripLineKey,
} from './strip-phase';

const NOW = Date.parse('2026-07-06T10:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe('isFreshBook', () => {
  it('is fresh inside the window and stale outside it', () => {
    expect(isFreshBook(minutesAgo(1), NOW)).toBe(true);
    expect(isFreshBook(minutesAgo(9), NOW)).toBe(true);
    expect(isFreshBook(minutesAgo(11), NOW)).toBe(false);
    expect(isFreshBook(new Date(NOW - FRESH_WINDOW_MS).toISOString(), NOW)).toBe(false);
  });

  it('treats an unparseable createdAt as stale, never as in-flight', () => {
    expect(isFreshBook('not-a-date', NOW)).toBe(false);
  });
});

describe('allPagesAnalyzed', () => {
  it('requires every photo page to carry analysis', () => {
    expect(
      allPagesAnalyzed([
        { assetId: 'a1', analysis: { setting: 'park' } },
        { assetId: 'a2', analysis: { setting: 'home' } },
      ]),
    ).toBe(true);
    expect(
      allPagesAnalyzed([
        { assetId: 'a1', analysis: { setting: 'park' } },
        { assetId: 'a2', analysis: null },
      ]),
    ).toBe(false);
  });

  it('ignores non-photo pages and rejects empty page sets', () => {
    expect(
      allPagesAnalyzed([
        { assetId: 'a1', analysis: {} },
        { assetId: null, analysis: null }, // app-authored page, no photo
      ]),
    ).toBe(true);
    expect(allPagesAnalyzed([])).toBe(false);
  });
});

describe('initialStripPhase', () => {
  const base = {
    fresh: true,
    allAnalyzed: false,
    needsTitle: true,
    needsSummary: true,
    needsQuestions: true,
  };

  it('reads while a fresh book still needs perception fields', () => {
    expect(initialStripPhase(base)).toBe('reading');
    expect(
      initialStripPhase({
        ...base,
        needsTitle: false,
        needsSummary: false,
        needsQuestions: true,
      }),
    ).toBe('reading');
  });

  it('never mounts for a stale book — no waiting theater', () => {
    expect(initialStripPhase({ ...base, fresh: false })).toBe('hidden');
  });

  it('never mounts when analysis provably finished before the sheet opened', () => {
    expect(initialStripPhase({ ...base, allAnalyzed: true })).toBe('hidden');
  });

  it('never mounts when nothing is missing', () => {
    expect(
      initialStripPhase({
        ...base,
        needsTitle: false,
        needsSummary: false,
        needsQuestions: false,
      }),
    ).toBe('hidden');
  });
});

describe('arrivalStripPhase', () => {
  it('announces questions the moment they land', () => {
    expect(
      arrivalStripPhase('reading', {
        captureQuestionCount: 2,
        hasEventSummary: true,
        allAnalyzed: true,
      }),
    ).toBe('arrived');
  });

  it('settles quietly when perception lands with zero questions', () => {
    expect(
      arrivalStripPhase('reading', {
        captureQuestionCount: 0,
        hasEventSummary: true,
        allAnalyzed: false,
      }),
    ).toBe('arrivedQuiet');
    expect(
      arrivalStripPhase('reading', {
        captureQuestionCount: 0,
        hasEventSummary: false,
        allAnalyzed: true,
      }),
    ).toBe('arrivedQuiet');
  });

  it('keeps reading while nothing has landed', () => {
    expect(
      arrivalStripPhase('reading', {
        captureQuestionCount: 0,
        hasEventSummary: false,
        allAnalyzed: false,
      }),
    ).toBe('reading');
  });

  it('is sticky in every non-reading phase (refetches never re-announce)', () => {
    for (const prev of ['hidden', 'arrived', 'arrivedQuiet', 'settled'] as const) {
      expect(
        arrivalStripPhase(prev, {
          captureQuestionCount: 3,
          hasEventSummary: true,
          allAnalyzed: true,
        }),
      ).toBe(prev);
    }
  });
});

describe('stripLineKey', () => {
  it('stages the reading lines by elapsed time', () => {
    expect(stripLineKey('reading', 0, 0)).toBe('stripPeeking');
    expect(stripLineKey('reading', STRIP_FACES_AT_MS, 0)).toBe('stripFaces');
    expect(stripLineKey('reading', STRIP_READING_AT_MS, 0)).toBe('stripReading');
    expect(stripLineKey('reading', 120_000, 0)).toBe('stripReading');
  });

  it('maps arrival phases to their lines', () => {
    expect(stripLineKey('arrived', 0, 2)).toBe('stripQuestions');
    expect(stripLineKey('arrivedQuiet', 0, 0)).toBe('stripAllRead');
    expect(stripLineKey('settled', 0, 0)).toBe('stripRest');
    expect(stripLineKey('hidden', 0, 0)).toBeNull();
  });

  it('never promises questions when none are on screen', () => {
    expect(stripLineKey('arrived', 0, 0)).toBe('stripAllRead');
  });
});
