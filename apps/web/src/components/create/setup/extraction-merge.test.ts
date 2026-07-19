import { describe, it, expect } from 'vitest';
import { mergeExtractionFacts, type FactQuestionLabels } from './extraction-merge';
import type { SetupFormState } from './SetupSheet';
import type { RosterCharacterLike } from './discovery-feed';
import type { RambleExtraction } from '@/lib/ramble-extract';

const labels: FactQuestionLabels = {
  location: 'Where the day happened',
  highlight: 'The best moment',
  mishap: 'A little mishap',
  childSaid: 'Something they said',
  nameQuestionFor: (d) => `What should we call ${d}?`,
};

const form: SetupFormState = {
  childName: '',
  title: '',
  eventSummary: 'long ramble',
  captureQuestions: [
    { id: 'q1', question: 'Who is the woman?', options: ['Grandma'], characterId: 'adult_1' },
  ],
  artStyle: 'vignette',
  tone: null,
  learningWords: [],
  reviewFirst: false,
  themeLine: 'a beach day',
  castMode: 'star',
  starCharacterId: null,
  castMemberIds: [],
};

const roster: RosterCharacterLike[] = [
  { characterId: 'child_1', role: 'main_child', appearsOnPages: [1, 2] },
  { characterId: 'adult_1', role: 'grandparent', appearsOnPages: [1, 3] },
];

const facts: RambleExtraction = {
  starName: 'Leo',
  people: [
    { characterId: 'child_1', name: 'Leo' },
    { characterId: 'adult_1', name: 'Nana Ray' },
  ],
  location: 'Camber Sands',
  highlight: 'the big wave',
  mishap: null,
  childSaid: 'again, again!',
  themeLine: 'first swim at Camber Sands',
};

const untouched = { childName: false, themeLine: false, castMode: false };

describe('mergeExtractionFacts', () => {
  it('fills the star name, binds the star, answers naming rows, adds fact rows, refines the theme', () => {
    const { form: next, changed } = mergeExtractionFacts(form, facts, roster, labels, untouched);
    expect(next.childName).toBe('Leo');
    expect(next.starCharacterId).toBe('child_1');
    expect(next.captureQuestions.find((q) => q.id === 'q1')?.answer).toBe('Nana Ray');
    expect(next.captureQuestions.find((q) => q.id === 'ramble_location')?.answer).toBe(
      'Camber Sands',
    );
    expect(next.captureQuestions.find((q) => q.id === 'ramble_child_said')?.answer).toBe(
      'again, again!',
    );
    expect(next.captureQuestions.some((q) => q.id === 'ramble_mishap')).toBe(false);
    expect(next.themeLine).toBe('first swim at Camber Sands');
    expect(Object.keys(changed).sort()).toEqual([
      'captureQuestions',
      'castMode',
      'childName',
      'starCharacterId',
      'themeLine',
    ]);
  });

  it('parent input wins: touched fields and existing answers never change', () => {
    const touched = { childName: true, themeLine: true, castMode: true };
    const answered = {
      ...form,
      childName: 'Maya',
      captureQuestions: [{ ...form.captureQuestions[0], answer: 'Granny P' }],
    };
    const { form: next } = mergeExtractionFacts(answered, facts, roster, labels, touched);
    expect(next.childName).toBe('Maya');
    expect(next.themeLine).toBe('a beach day');
    expect(next.starCharacterId).toBeNull();
    expect(next.captureQuestions.find((q) => q.id === 'q1')?.answer).toBe('Granny P');
  });

  it('re-extraction updates ramble_* rows in place', () => {
    const first = mergeExtractionFacts(form, facts, roster, labels, untouched).form;
    const second = mergeExtractionFacts(
      first,
      { ...facts, highlight: 'the ice cream drop' },
      roster,
      labels,
      untouched,
    ).form;
    expect(second.captureQuestions.filter((q) => q.id === 'ramble_highlight')).toHaveLength(1);
    expect(second.captureQuestions.find((q) => q.id === 'ramble_highlight')?.answer).toBe(
      'the ice cream drop',
    );
  });

  it('no facts → no changes', () => {
    const empty: RambleExtraction = {
      starName: null,
      people: [],
      location: null,
      highlight: null,
      mishap: null,
      childSaid: null,
      themeLine: null,
    };
    expect(mergeExtractionFacts(form, empty, roster, labels, untouched).changed).toEqual({});
  });
});
