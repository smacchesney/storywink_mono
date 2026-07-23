import { describe, it, expect } from 'vitest';
import { mergeBookIntoForm, type MergeTouchedFlags, type MergeableBook } from './merge-book-form';
import type { SetupFormState } from './SetupSheet';

const untouched: MergeTouchedFlags = {
  childName: false,
  title: false,
  eventSummary: false,
  captureQuestions: false,
  artStyle: false,
  tone: false,
  learningWords: false,
  themeLine: false,
  castMode: false,
};

const prev: SetupFormState = {
  childName: '',
  title: '',
  eventSummary: '',
  captureQuestions: [],
  artStyle: 'vignette',
  tone: null,
  learningWords: [],
  reviewFirst: false,
  themeLine: '',
  castMode: 'star',
  starCharacterId: null,
  castMemberIds: [],
};

const emptyBook: MergeableBook = {
  title: '',
  childName: null,
  eventSummary: null,
  captureQuestions: null,
  artStyle: null,
  tone: null,
  learningWords: null,
  themeLine: null,
  castMode: null,
  starCharacterId: null,
  castMemberIds: null,
};

describe('mergeBookIntoForm — artStyle', () => {
  it('keeps a parent-touched artStyle when a poll merge lands', () => {
    const next = mergeBookIntoForm(
      prev,
      { ...emptyBook, artStyle: 'origami' },
      { ...untouched, artStyle: true },
    );
    expect(next.artStyle).toBe('vignette');
  });

  it('applies a resumed draft artStyle when untouched', () => {
    const next = mergeBookIntoForm(prev, { ...emptyBook, artStyle: 'origami' }, untouched);
    expect(next.artStyle).toBe('origami');
  });

  it('ignores an invalid artStyle', () => {
    const next = mergeBookIntoForm(prev, { ...emptyBook, artStyle: 'not-a-style' }, untouched);
    expect(next.artStyle).toBe('vignette');
  });
});

describe('mergeBookIntoForm — sibling guards (extraction lock)', () => {
  it('fills untouched scalars and skips touched ones', () => {
    const book = {
      ...emptyBook,
      title: 'Beach Day',
      childName: 'Leo',
      eventSummary: 'we swam',
      tone: 'silly',
      themeLine: 'a splashy day',
    };
    const filled = mergeBookIntoForm(prev, book, untouched);
    expect(filled.title).toBe('Beach Day');
    expect(filled.childName).toBe('Leo');
    expect(filled.eventSummary).toBe('we swam');
    expect(filled.tone).toBe('silly');
    expect(filled.themeLine).toBe('a splashy day');

    const edited = { ...prev, title: 'My Title', eventSummary: 'my words' };
    const kept = mergeBookIntoForm(edited, book, {
      ...untouched,
      title: true,
      eventSummary: true,
    });
    expect(kept.title).toBe('My Title');
    expect(kept.eventSummary).toBe('my words');
  });

  it('rejects a tone outside STORY_MOODS', () => {
    const next = mergeBookIntoForm(prev, { ...emptyBook, tone: 'grumpy' }, untouched);
    expect(next.tone).toBeNull();
  });

  it('maps learningWords rows to bare words, capped at 4', () => {
    const next = mergeBookIntoForm(
      prev,
      { ...emptyBook, learningWords: [{ word: 'splash' }, { word: 'crab' }, {}, { word: '' }] },
      untouched,
    );
    expect(next.learningWords).toEqual(['splash', 'crab']);
  });

  it('restores ensemble cast when untouched, keeps a touched castMode', () => {
    const book = { ...emptyBook, castMode: 'ensemble', castMemberIds: ['c1', 'c2', 3] };
    const next = mergeBookIntoForm(prev, book, untouched);
    expect(next.castMode).toBe('ensemble');
    expect(next.castMemberIds).toEqual(['c1', 'c2']);

    const kept = mergeBookIntoForm(prev, book, { ...untouched, castMode: true });
    expect(kept.castMode).toBe('star');
  });

  it('restores a star binding when untouched', () => {
    const next = mergeBookIntoForm(prev, { ...emptyBook, starCharacterId: 'c9' }, untouched);
    expect(next.castMode).toBe('star');
    expect(next.starCharacterId).toBe('c9');
  });
});
