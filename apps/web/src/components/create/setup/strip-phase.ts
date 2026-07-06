/**
 * Pure state machine for the LibrarianStrip on the setup sheet.
 *
 * Phases:
 * - hidden:        strip never mounts (perception already landed, or the book
 *                  is not fresh — no work is plausibly in flight).
 * - reading:       perception is (plausibly) running; staged narration lines.
 * - arrived:       perception delivered capture questions.
 * - arrivedQuiet:  perception landed with zero questions.
 * - settled:       the poll capped out — slow and failed are indistinguishable
 *                  and treated identically. The sheet stays fully usable.
 */
export type StripPhase =
  | 'hidden'
  | 'reading'
  | 'arrived'
  | 'arrivedQuiet'
  | 'settled';

/** A book older than this has no perception pass plausibly in flight. */
export const FRESH_WINDOW_MS = 10 * 60_000;

export function isFreshBook(createdAt: string, now: number): boolean {
  const created = new Date(createdAt).getTime();
  return Number.isFinite(created) && now - created < FRESH_WINDOW_MS;
}

/**
 * True when every photo page (assetId != null — mirrors the perception
 * worker's own page filter) carries a persisted analysis. Analysis and the
 * book-level fields write in one transaction, so this doubles as "the
 * perception pass provably finished".
 */
export function allPagesAnalyzed(
  pages: Array<{ assetId: string | null; analysis?: unknown }>,
): boolean {
  const photoPages = pages.filter((p) => p.assetId != null);
  return photoPages.length > 0 && photoPages.every((p) => p.analysis != null);
}

/**
 * Phase at initial load. No waiting theater when the fields are already
 * there, when analysis provably finished, or when the book is stale.
 */
export function initialStripPhase(opts: {
  fresh: boolean;
  allAnalyzed: boolean;
  needsTitle: boolean;
  needsSummary: boolean;
  needsQuestions: boolean;
}): StripPhase {
  if (!opts.fresh || opts.allAnalyzed) return 'hidden';
  if (opts.needsTitle || opts.needsSummary || opts.needsQuestions) {
    return 'reading';
  }
  return 'hidden';
}

/**
 * Transition applied on every poll/refetch merge. Only a strip that is
 * currently narrating can announce an arrival; every other phase is sticky.
 */
export function arrivalStripPhase(
  prev: StripPhase,
  book: {
    captureQuestionCount: number;
    hasEventSummary: boolean;
    allAnalyzed: boolean;
  },
): StripPhase {
  if (prev !== 'reading') return prev;
  if (book.captureQuestionCount > 0) return 'arrived';
  if (book.hasEventSummary || book.allAnalyzed) return 'arrivedQuiet';
  return prev;
}

export type StripLineKey =
  | 'stripPeeking'
  | 'stripFaces'
  | 'stripReading'
  | 'stripQuestions'
  | 'stripAllRead'
  | 'stripRest';

/** Staged-line schedule while reading (ms from strip mount). */
export const STRIP_FACES_AT_MS = 7_000;
export const STRIP_READING_AT_MS = 18_000;

/**
 * Which copy key the strip shows. While reading, lines stage by time from
 * mount; after arrival the line is fixed by phase. An 'arrived' phase with
 * zero questions falls back to the all-read line so the copy never promises
 * questions that are not on screen.
 */
export function stripLineKey(
  phase: StripPhase,
  elapsedMs: number,
  questionCount: number,
): StripLineKey | null {
  switch (phase) {
    case 'hidden':
      return null;
    case 'reading':
      if (elapsedMs < STRIP_FACES_AT_MS) return 'stripPeeking';
      if (elapsedMs < STRIP_READING_AT_MS) return 'stripFaces';
      return 'stripReading';
    case 'arrived':
      return questionCount > 0 ? 'stripQuestions' : 'stripAllRead';
    case 'arrivedQuiet':
      return 'stripAllRead';
    case 'settled':
      return 'stripRest';
  }
}
