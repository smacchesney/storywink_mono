import { describe, it, expect } from 'vitest';
import {
  buildConfirmedFacts,
  resolveCastForStory,
  SKIP_SENTINEL,
  RawCastCharacter,
} from './storyCast.js';

describe('buildConfirmedFacts', () => {
  it('formats answered questions as "question → answer" lines', () => {
    const facts = buildConfirmedFacts([
      { question: 'Was this her first beach trip?', answer: 'Yes, first time!' },
    ]);
    expect(facts).toEqual(['Was this her first beach trip? → Yes, first time!']);
  });

  it('filters out the __skip__ sentinel', () => {
    const facts = buildConfirmedFacts([
      { question: 'Who is the woman with silver hair?', answer: SKIP_SENTINEL },
      { question: 'What made everyone laugh?', answer: 'The seagull stole a chip' },
    ]);
    expect(facts).toEqual(['What made everyone laugh? → The seagull stole a chip']);
  });

  it('filters out unanswered and blank answers', () => {
    const facts = buildConfirmedFacts([
      { question: 'Q1' },
      { question: 'Q2', answer: null },
      { question: 'Q3', answer: '' },
      { question: 'Q4', answer: '   ' },
    ]);
    expect(facts).toEqual([]);
  });

  it('returns [] for null or undefined input', () => {
    expect(buildConfirmedFacts(null)).toEqual([]);
    expect(buildConfirmedFacts(undefined)).toEqual([]);
  });
});

describe('resolveCastForStory', () => {
  const character = (overrides: Partial<RawCastCharacter>): RawCastCharacter => ({
    characterId: 'adult_1',
    role: 'grandparent',
    name: null,
    appearsOnPages: [1, 3],
    appearsOnAssetIds: ['asset-a', 'asset-c'],
    ...overrides,
  });

  it('returns exact current pages when every stamped asset survives (reorder-safe)', () => {
    // Photos reordered since perception: asset-c now first, asset-a third.
    const cast = resolveCastForStory([character({})], ['asset-c', 'asset-b', 'asset-a']);
    expect(cast).toEqual([
      { characterId: 'adult_1', name: 'grandparent', role: 'grandparent', appearsOnPages: [1, 3] },
    ]);
  });

  it('goes page-less when only some stamped assets survive', () => {
    const cast = resolveCastForStory(
      [character({})],
      ['asset-a', 'asset-b'], // asset-c was removed
    );
    expect(cast).toEqual([
      { characterId: 'adult_1', name: 'grandparent', role: 'grandparent', appearsOnPages: [] },
    ]);
  });

  it('drops characters whose every photo was removed', () => {
    const cast = resolveCastForStory(
      [
        character({}),
        character({ characterId: 'child_1', role: 'main_child', appearsOnAssetIds: ['asset-b'] }),
      ],
      ['asset-b'], // asset-a and asset-c gone — the grandparent must not re-enter the story
    );
    expect(cast).toEqual([
      { characterId: 'child_1', name: 'main child', role: 'main_child', appearsOnPages: [1] },
    ]);
  });

  it('drops legacy characters without assetId stamps', () => {
    expect(resolveCastForStory([character({ appearsOnAssetIds: undefined })], ['asset-a'])).toEqual(
      [],
    );
    expect(
      resolveCastForStory([character({ appearsOnAssetIds: [null, null] })], ['asset-a']),
    ).toEqual([]);
  });

  it('skips null stamps but resolves the rest exactly', () => {
    const cast = resolveCastForStory(
      [character({ appearsOnAssetIds: [null, 'asset-a'] })],
      ['asset-b', 'asset-a'],
    );
    expect(cast).toEqual([
      { characterId: 'adult_1', name: 'grandparent', role: 'grandparent', appearsOnPages: [2] },
    ]);
  });

  it('dedupes and sorts resolved pages', () => {
    const cast = resolveCastForStory(
      [character({ appearsOnAssetIds: ['asset-c', 'asset-a', 'asset-a'] })],
      ['asset-a', 'asset-b', 'asset-c'],
    );
    expect(cast[0].appearsOnPages).toEqual([1, 3]);
  });

  it('prefers the confirmed name over the humanized role', () => {
    const cast = resolveCastForStory(
      [character({ name: 'Grandma', appearsOnAssetIds: ['asset-a'] })],
      ['asset-a'],
    );
    expect(cast[0].name).toBe('Grandma');
  });
});
