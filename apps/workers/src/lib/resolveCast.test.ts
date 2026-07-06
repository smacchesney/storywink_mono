import { describe, it, expect } from 'vitest';
import {
  mergeCastNames,
  checkCastNameCoverage,
  isGenericCategoryAnswer,
  MergeableCharacter,
} from './resolveCast.js';
import { SKIP_SENTINEL } from './storyCast.js';

const character = (overrides: Partial<MergeableCharacter>): MergeableCharacter => ({
  characterId: 'adult_1',
  role: 'grandparent',
  name: null,
  ...overrides,
});

const mainChild = character({ characterId: 'child_1', role: 'main_child' });

describe('mergeCastNames', () => {
  it('merges a chip answer onto its character by characterId and consumes the question', () => {
    const result = mergeCastNames({
      characters: [mainChild, character({})],
      captureQuestions: [
        { id: 'q1', characterId: 'adult_1', answer: 'Grandma' },
      ],
      childName: 'Emma',
    });
    const grandma = result.characters.find(c => c.characterId === 'adult_1')!;
    expect(grandma.name).toBe('Grandma');
    expect(grandma.namedVia).toBe('chip');
    expect(result.consumedQuestionIds).toEqual(['q1']);
    expect(result.changed).toBe(true);
  });

  it('sets main_child from childName with namedVia childName', () => {
    const result = mergeCastNames({
      characters: [mainChild],
      captureQuestions: [],
      childName: '  Emma ',
    });
    const main = result.characters[0];
    expect(main.name).toBe('Emma');
    expect(main.namedVia).toBe('childName');
  });

  it('does NOT consume an answer whose join failed (stays a confirmedFacts line)', () => {
    const result = mergeCastNames({
      characters: [mainChild, character({}), character({ characterId: 'adult_2', role: 'parent' })],
      captureQuestions: [{ id: 'q1', characterId: 'ghost_9', answer: 'Grandma' }],
      childName: null,
    });
    expect(result.consumedQuestionIds).toEqual([]);
    expect(result.characters.every(c => c.name === null)).toBe(true);
  });

  it('never guesses on a failed join, even with a single unnamed candidate (unnamed beats misnamed)', () => {
    // The person the chip asked about may have been removed with their
    // photos — their name must not land on whoever happens to remain.
    const result = mergeCastNames({
      characters: [mainChild, character({ characterId: 'adult_2', role: 'parent' })],
      captureQuestions: [{ id: 'q1', characterId: 'adult_1', answer: 'Grandma' }],
      childName: null,
    });
    const remaining = result.characters.find(c => c.characterId === 'adult_2')!;
    expect(remaining.name).toBeNull();
    expect(result.consumedQuestionIds).toEqual([]);
  });

  it('treats a generic-category answer as role refinement, never a name (still consumed)', () => {
    const result = mergeCastNames({
      characters: [mainChild, character({ role: 'adult' })],
      captureQuestions: [{ id: 'q1', characterId: 'adult_1', answer: 'Family friend' }],
      childName: null,
    });
    const friend = result.characters.find(c => c.characterId === 'adult_1')!;
    expect(friend.name).toBeNull();
    expect(friend.namedVia).toBeUndefined();
    expect(friend.role).toBe('family friend');
    expect(result.consumedQuestionIds).toEqual(['q1']);
  });

  it('names a pet from a chip answer ("Our dog" is child vocabulary, not a category)', () => {
    const result = mergeCastNames({
      characters: [mainChild, character({ characterId: 'pet_1', role: 'pet' })],
      captureQuestions: [{ id: 'q1', characterId: 'pet_1', answer: 'Our dog' }],
      childName: null,
    });
    const pet = result.characters.find(c => c.characterId === 'pet_1')!;
    expect(pet.name).toBe('Our dog');
    expect(pet.namedVia).toBe('chip');
  });

  it("refines a pet's role for a generic pet category (\"A friend's cat\")", () => {
    const result = mergeCastNames({
      characters: [mainChild, character({ characterId: 'pet_1', role: 'pet' })],
      captureQuestions: [{ id: 'q1', characterId: 'pet_1', answer: "A friend's cat" }],
      childName: null,
    });
    const pet = result.characters.find(c => c.characterId === 'pet_1')!;
    expect(pet.name).toBeNull();
    expect(pet.role).toBe("a friend's cat");
    expect(result.consumedQuestionIds).toEqual(['q1']);
  });

  it('ignores skipped, blank, and unanswered questions', () => {
    const result = mergeCastNames({
      characters: [mainChild, character({})],
      captureQuestions: [
        { id: 'q1', characterId: 'adult_1', answer: SKIP_SENTINEL },
        { id: 'q2', characterId: 'adult_1', answer: '   ' },
        { id: 'q3', characterId: 'adult_1' },
        { id: 'q4', answer: 'The huge splash' }, // no characterId — not a naming answer
      ],
      childName: null,
    });
    expect(result.consumedQuestionIds).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it('never lets a chip answer rename the main child (childName wins)', () => {
    const result = mergeCastNames({
      characters: [mainChild],
      captureQuestions: [{ id: 'q1', characterId: 'child_1', answer: 'Grandma' }],
      childName: 'Emma',
    });
    expect(result.characters[0].name).toBe('Emma');
    expect(result.characters[0].namedVia).toBe('childName');
    expect(result.consumedQuestionIds).toEqual([]);
  });

  it('reports changed=false when the merge is a no-op (already merged)', () => {
    const result = mergeCastNames({
      characters: [
        character({ characterId: 'child_1', role: 'main_child', name: 'Emma', namedVia: 'childName' }),
        character({ name: 'Grandma', namedVia: 'chip' }),
      ],
      captureQuestions: [{ id: 'q1', characterId: 'adult_1', answer: 'Grandma' }],
      childName: 'Emma',
    });
    expect(result.changed).toBe(false);
    expect(result.consumedQuestionIds).toEqual(['q1']);
  });

  it('does not mutate its inputs', () => {
    const original = character({});
    mergeCastNames({
      characters: [original],
      captureQuestions: [{ id: 'q1', characterId: 'adult_1', answer: 'Grandma' }],
      childName: null,
    });
    expect(original.name).toBeNull();
  });
});

describe('isGenericCategoryAnswer', () => {
  it.each(['Family friend', 'a friend', 'Neighbour', "A friend's dog", 'ともだちの ねこ', 'しりあい'])(
    'flags %s as generic',
    answer => expect(isGenericCategoryAnswer(answer)).toBe(true),
  );

  it.each(['Grandma', 'Auntie Mei', 'Our dog', "Grandma's dog", 'おばあちゃん', 'Rex'])(
    'keeps %s as a usable name',
    answer => expect(isGenericCategoryAnswer(answer)).toBe(false),
  );
});

describe('checkCastNameCoverage', () => {
  const pages = [
    'Emma wiggles her toes in the sand.', // page 1
    'Grandma laughs. The waves say hello!', // page 2
    'One more splash!', // page 3
    'Time to go home.', // page 4
  ];

  it('covers a chip-named character mentioned on one of their pages', () => {
    const result = checkCastNameCoverage(
      [{ name: 'Grandma', role: 'grandparent', namedVia: 'chip', appearsOnPages: [2, 4] }],
      pages,
    );
    expect(result).toEqual({ checked: 1, covered: 1, missing: [], skippedScript: 0 });
  });

  it('allows a ±1-page tolerance around appearances', () => {
    const result = checkCastNameCoverage(
      // Only on page 3 — mention on page 2 is within tolerance.
      [{ name: 'Grandma', role: 'grandparent', namedVia: 'chip', appearsOnPages: [3] }],
      pages,
    );
    expect(result.covered).toBe(1);
  });

  it('reports a miss outside the window', () => {
    const result = checkCastNameCoverage(
      [{ name: 'Grandma', role: 'grandparent', namedVia: 'chip', appearsOnPages: [4] }],
      pages,
    );
    expect(result.covered).toBe(0);
    expect(result.missing).toEqual(['Grandma']);
  });

  it('checks page-less entries against the whole book', () => {
    const result = checkCastNameCoverage(
      [{ name: 'Grandma', role: 'grandparent', namedVia: 'chip', appearsOnPages: [] }],
      pages,
    );
    expect(result.covered).toBe(1);
  });

  it('only targets parent-confirmed entries (fallback/unset namedVia are ignored)', () => {
    const result = checkCastNameCoverage(
      [
        { name: 'grandparent', role: 'grandparent', namedVia: 'fallback', appearsOnPages: [2] },
        { name: 'Uncle Bob', role: 'uncle', appearsOnPages: [2] },
      ],
      pages,
    );
    expect(result).toEqual({ checked: 0, covered: 0, missing: [], skippedScript: 0 });
  });

  it('script-gates cross-script names instead of failing them', () => {
    const result = checkCastNameCoverage(
      // Latin name in a ja book — transliterated to katakana by the prompt,
      // so a raw substring check can never pass. Skip, never fail.
      [{ name: 'Emma', role: 'main_child', namedVia: 'childName', appearsOnPages: [1] }],
      ['えまが すなに あしを うずめます。'],
      'ja',
    );
    expect(result).toEqual({ checked: 0, covered: 0, missing: [], skippedScript: 1 });
  });

  it('matches kana names as substrings in ja text', () => {
    const result = checkCastNameCoverage(
      [{ name: 'おばあちゃん', role: 'grandparent', namedVia: 'chip', appearsOnPages: [1] }],
      ['おばあちゃんと いっしょに わらったね。'],
      'ja',
    );
    expect(result.covered).toBe(1);
  });

  it('matches Latin names on word boundaries only', () => {
    const result = checkCastNameCoverage(
      [{ name: 'Sam', role: 'friend', namedVia: 'chip', appearsOnPages: [1] }],
      ['Samantha twirls in the rain.'],
    );
    expect(result.covered).toBe(0);
    expect(result.missing).toEqual(['Sam']);
  });
});
