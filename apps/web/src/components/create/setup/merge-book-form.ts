// Same-folder imports stay relative (vitest resolves no `@/` alias; see
// setup-submit.ts:1). @storywink/shared resolves as a workspace package.
import { isValidStyle, type StyleKey } from '@storywink/shared/prompts/styles';
import { STORY_MOODS, type StoryMood } from '@storywink/shared/constants';
import type { SetupFormState } from './SetupSheet';
import type { CaptureQuestion } from './CaptureChips';
import { mergeCaptureQuestions } from './star-ask';

/** The form-relevant slice of a fetched book (structural subset of BookData). */
export interface MergeableBook {
  title: string;
  childName: string | null;
  eventSummary: string | null;
  captureQuestions: CaptureQuestion[] | null;
  artStyle: string | null;
  tone: string | null;
  learningWords: { word?: string }[] | null;
  themeLine?: string | null;
  castMode?: string | null;
  starCharacterId?: string | null;
  castMemberIds?: unknown;
}

/** Which fields the parent has edited — a merge never overwrites these. */
export interface MergeTouchedFlags {
  childName: boolean;
  title: boolean;
  eventSummary: boolean;
  captureQuestions: boolean;
  artStyle: boolean;
  tone: boolean;
  learningWords: boolean;
  themeLine: boolean;
  castMode: boolean;
}

/**
 * Merge a freshly fetched book into form state, respecting parent edits.
 * Pure — the setForm updater for the perception poll and photo refetches.
 */
export function mergeBookIntoForm(
  prev: SetupFormState,
  book: MergeableBook,
  touched: MergeTouchedFlags,
): SetupFormState {
  const next = { ...prev };
  if (!touched.title && book.title?.trim()) next.title = book.title;
  if (!touched.childName && book.childName) next.childName = book.childName;
  if (!touched.eventSummary && book.eventSummary) next.eventSummary = book.eventSummary;
  if (!touched.captureQuestions && book.captureQuestions?.length) {
    // Id-preserving merge: a poll tick landing before handlePickEveryone's
    // PATCH round-trips must not clobber the synthetic `name_` naming rows
    // it injected without marking captureQuestions touched.
    next.captureQuestions = mergeCaptureQuestions(book.captureQuestions, prev.captureQuestions);
  }
  if (!touched.artStyle && book.artStyle && isValidStyle(book.artStyle)) {
    next.artStyle = book.artStyle as StyleKey;
  }
  // Only ever fills a resumed draft's own earlier choice — nothing but
  // the parent's tap writes Book.tone, so untouched means unwritten.
  if (!touched.tone && book.tone && (STORY_MOODS as readonly string[]).includes(book.tone)) {
    next.tone = book.tone as StoryMood;
  }
  // Resumed drafts show their earlier learning words; parent edits win.
  if (!touched.learningWords && Array.isArray(book.learningWords)) {
    const words = (book.learningWords as { word?: string }[])
      .map((w) => (typeof w?.word === 'string' ? w.word : ''))
      .filter(Boolean)
      .slice(0, 4);
    if (words.length > 0) next.learningWords = words;
  }
  if (!touched.themeLine && book.themeLine?.trim()) next.themeLine = book.themeLine;
  if (!touched.castMode) {
    if (book.castMode === 'ensemble' && Array.isArray(book.castMemberIds)) {
      next.castMode = 'ensemble';
      next.castMemberIds = (book.castMemberIds as unknown[]).filter(
        (id): id is string => typeof id === 'string',
      );
    } else if (book.starCharacterId) {
      next.castMode = 'star';
      next.starCharacterId = book.starCharacterId;
    }
  }
  return next;
}
