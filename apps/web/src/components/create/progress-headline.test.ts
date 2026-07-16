import { describe, it, expect } from 'vitest';
import { resolveProgressHeadline, ProgressSnapshot } from './progress-headline';

const snap = (over: Partial<ProgressSnapshot> = {}): ProgressSnapshot => ({
  status: 'GENERATING',
  generationPhase: null,
  totalPages: 8,
  pagesWithText: 0,
  pagesWithIllustrations: 0,
  childName: null,
  ...over,
});

describe('resolveProgressHeadline — worker phases', () => {
  it("phase 'story' narrates writing, with the child's name when known", () => {
    expect(resolveProgressHeadline(snap({ generationPhase: 'story' }))).toEqual({
      key: 'writingStory',
    });
    expect(resolveProgressHeadline(snap({ generationPhase: 'story', childName: 'Mika' }))).toEqual({
      key: 'writingStoryFor',
      values: { name: 'Mika' },
    });
  });

  it("phase 'story_check' narrates the read-back", () => {
    expect(resolveProgressHeadline(snap({ generationPhase: 'story_check' }))).toEqual({
      key: 'checkingStory',
    });
  });

  it("a QC-fail regeneration (phase back to 'story') returns to writing", () => {
    // The story worker writes 'story' again when regeneration begins, so the
    // stage emits a mid-flight signal — the headline must follow it back.
    expect(resolveProgressHeadline(snap({ generationPhase: 'story', pagesWithText: 8 }))).toEqual({
      key: 'writingStory',
    });
  });

  it("phase 'characters' narrates character work", () => {
    expect(
      resolveProgressHeadline(snap({ status: 'ILLUSTRATING', generationPhase: 'characters' })),
    ).toEqual({ key: 'gettingCharacters' });
  });

  it("phase 'illustrating' counts pages, clamped to the total", () => {
    expect(
      resolveProgressHeadline(
        snap({
          status: 'ILLUSTRATING',
          generationPhase: 'illustrating',
          pagesWithIllustrations: 3,
        }),
      ),
    ).toEqual({ key: 'illustratingPage', values: { current: 4, total: 8 } });
    expect(
      resolveProgressHeadline(
        snap({
          status: 'ILLUSTRATING',
          generationPhase: 'illustrating',
          pagesWithIllustrations: 8,
        }),
      ),
    ).toEqual({ key: 'illustratingPage', values: { current: 8, total: 8 } });
  });

  it("phase 'illustrating' with zero known pages falls back to characters copy", () => {
    expect(
      resolveProgressHeadline(
        snap({ status: 'ILLUSTRATING', generationPhase: 'illustrating', totalPages: 0 }),
      ),
    ).toEqual({ key: 'gettingCharacters' });
  });

  it("phase 'finishing' and 'polishing' narrate the QC endgame", () => {
    expect(
      resolveProgressHeadline(snap({ status: 'ILLUSTRATING', generationPhase: 'finishing' })),
    ).toEqual({ key: 'finishingTouches' });
    expect(
      resolveProgressHeadline(snap({ status: 'ILLUSTRATING', generationPhase: 'polishing' })),
    ).toEqual({ key: 'polishingPages' });
  });
});

describe('resolveProgressHeadline — stale/unknown phases fall back', () => {
  it('a story phase left on an ILLUSTRATING book is not trusted', () => {
    expect(
      resolveProgressHeadline(
        snap({ status: 'ILLUSTRATING', generationPhase: 'story', pagesWithIllustrations: 2 }),
      ),
    ).toEqual({ key: 'illustratingPage', values: { current: 3, total: 8 } });
  });

  it('an illustration phase left on a GENERATING book is not trusted', () => {
    expect(
      resolveProgressHeadline(snap({ generationPhase: 'finishing', pagesWithText: 8 })),
    ).toEqual({ key: 'writingStory' });
  });

  it('an unknown phase string is ignored', () => {
    expect(resolveProgressHeadline(snap({ generationPhase: 'warp_drive' }))).toEqual({
      key: 'readingPhotos',
    });
  });
});

describe('resolveProgressHeadline — null phase keeps the original behavior', () => {
  it('GENERATING before any text reads photos', () => {
    expect(resolveProgressHeadline(snap())).toEqual({ key: 'readingPhotos' });
  });

  it('GENERATING with text writes the story', () => {
    expect(resolveProgressHeadline(snap({ pagesWithText: 3 }))).toEqual({ key: 'writingStory' });
  });

  it('ILLUSTRATING with no images yet gets characters', () => {
    expect(resolveProgressHeadline(snap({ status: 'ILLUSTRATING' }))).toEqual({
      key: 'gettingCharacters',
    });
  });

  it('ILLUSTRATING with images counts pages', () => {
    expect(
      resolveProgressHeadline(snap({ status: 'ILLUSTRATING', pagesWithIllustrations: 5 })),
    ).toEqual({ key: 'illustratingPage', values: { current: 6, total: 8 } });
  });

  it('STORY_READY (transient) narrates like GENERATING with text', () => {
    expect(resolveProgressHeadline(snap({ status: 'STORY_READY', pagesWithText: 8 }))).toEqual({
      key: 'writingStory',
    });
  });
});
