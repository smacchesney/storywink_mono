/**
 * Pure mapping from a book-status snapshot to the progress screen's
 * headline. Kept free of React/Next/Prisma imports so it stays unit-testable.
 *
 * The workers write `Book.generationPhase` at real pipeline transitions;
 * this maps each phase to a truthful headline key. A null/unknown/stale
 * phase falls back to the status-only logic the screen shipped with, so a
 * worker crash between writes degrades to today's behavior, never worse.
 */

/** Worker-written pipeline phases (finer-grained than BookStatus). */
export type GenerationPhase =
  'story' | 'story_check' | 'characters' | 'illustrating' | 'finishing' | 'polishing';

export interface ProgressSnapshot {
  /** BookStatus as a string ('GENERATING', 'ILLUSTRATING', ...). */
  status: string | null;
  generationPhase: string | null;
  totalPages: number;
  pagesWithText: number;
  pagesWithIllustrations: number;
  childName: string | null;
  /** PHOTO_STORY | AVATAR_STORY — avatar books never read photos. */
  bookType?: string | null;
}

export interface ProgressHeadline {
  key:
    | 'readingPhotos'
    | 'writingStory'
    | 'writingStoryFor'
    | 'checkingStory'
    | 'gettingCharacters'
    | 'illustratingPage'
    | 'finishingTouches'
    | 'polishingPages';
  values?: Record<string, string | number>;
}

// A phase is only trusted when it agrees with the coarse status — a stale
// phase left behind by a crashed worker must not narrate the wrong stage.
const PHASES_FOR_STATUS: Record<string, GenerationPhase[]> = {
  GENERATING: ['story', 'story_check'],
  ILLUSTRATING: ['characters', 'illustrating', 'finishing', 'polishing'],
};

export function resolveProgressHeadline(snapshot: ProgressSnapshot): ProgressHeadline {
  const { status, generationPhase, totalPages, pagesWithText, pagesWithIllustrations, childName } =
    snapshot;

  const trustedPhase =
    status &&
    generationPhase &&
    PHASES_FOR_STATUS[status]?.includes(generationPhase as GenerationPhase)
      ? (generationPhase as GenerationPhase)
      : null;

  switch (trustedPhase) {
    case 'story':
      return childName
        ? { key: 'writingStoryFor', values: { name: childName } }
        : { key: 'writingStory' };
    case 'story_check':
      return { key: 'checkingStory' };
    case 'characters':
      return { key: 'gettingCharacters' };
    case 'finishing':
      return { key: 'finishingTouches' };
    case 'polishing':
      return { key: 'polishingPages' };
    case 'illustrating':
      if (totalPages > 0) {
        return {
          key: 'illustratingPage',
          values: {
            current: Math.min(pagesWithIllustrations + 1, totalPages),
            total: totalPages,
          },
        };
      }
      return { key: 'gettingCharacters' };
    case null:
      break;
  }

  // Status-only fallback — identical to the pre-phase behavior.
  if (status === 'ILLUSTRATING') {
    if (pagesWithIllustrations === 0 || totalPages === 0) {
      return { key: 'gettingCharacters' };
    }
    return {
      key: 'illustratingPage',
      values: {
        current: Math.min(pagesWithIllustrations + 1, totalPages),
        total: totalPages,
      },
    };
  }
  if (pagesWithText > 0) return { key: 'writingStory' };
  // Avatar-first books have no photos to read — the truthful pre-phase
  // fallback is the story being written, never 'Reading your photos'.
  if (snapshot.bookType === 'AVATAR_STORY') {
    return childName
      ? { key: 'writingStoryFor', values: { name: childName } }
      : { key: 'writingStory' };
  }
  return { key: 'readingPhotos' };
}
