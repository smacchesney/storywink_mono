import { describe, it, expect } from 'vitest';
import {
  scopeCaptureQuestions,
  CaptureQuestion,
  ScopeCharacterLike,
} from './photo-analysis.js';

const q = (overrides: Partial<CaptureQuestion>): CaptureQuestion => ({
  id: 'q1',
  question: 'Who is this?',
  options: ['Grandma', 'Auntie'],
  characterId: null,
  ...overrides,
});

const character = (
  overrides: Partial<ScopeCharacterLike>,
): ScopeCharacterLike => ({
  characterId: 'adult_1',
  role: 'grandparent',
  name: null,
  appearsOnPages: [1, 3],
  ...overrides,
});

const mainChild = character({
  characterId: 'child_1',
  role: 'main_child',
  appearsOnPages: [1, 2, 3, 4],
});

describe('scopeCaptureQuestions', () => {
  it('keeps a naming question for an unnamed character recurring with the child', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1', characterId: 'adult_1' })],
      [mainChild, character({})],
    );
    expect(result.map(x => x.id)).toEqual(['q1']);
  });

  it('drops naming questions for one-photo passersby', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1', characterId: 'adult_1' })],
      [mainChild, character({ appearsOnPages: [3] })],
    );
    expect(result).toEqual([]);
  });

  it('drops naming questions for background strangers who never share a photo with the child', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1', characterId: 'adult_1' })],
      [
        character({ characterId: 'child_1', role: 'main_child', appearsOnPages: [1, 2] }),
        character({ appearsOnPages: [3, 4] }), // recurs, but never with the child
      ],
    );
    expect(result).toEqual([]);
  });

  it('drops naming questions for already-named characters, unknown ids, and the main child', () => {
    const result = scopeCaptureQuestions(
      [
        q({ id: 'q1', characterId: 'adult_1' }), // already named
        q({ id: 'q2', characterId: 'ghost_9' }), // not in roster
        q({ id: 'q3', characterId: 'child_1' }), // the child is named on the sheet
      ],
      [mainChild, character({ name: 'Grandma' })],
    );
    expect(result).toEqual([]);
  });

  it('keeps one naming question per character (first wins)', () => {
    const result = scopeCaptureQuestions(
      [
        q({ id: 'q1', characterId: 'adult_1' }),
        q({ id: 'q2', characterId: 'adult_1' }),
      ],
      [mainChild, character({})],
    );
    expect(result.map(x => x.id)).toEqual(['q1']);
  });

  it('covers pets: an unnamed recurring pet sharing photos with the child qualifies', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1', characterId: 'pet_1', options: ['Our dog', "Grandma's dog"] })],
      [mainChild, character({ characterId: 'pet_1', role: 'pet', appearsOnPages: [2, 4] })],
    );
    expect(result.map(x => x.id)).toEqual(['q1']);
  });

  it('sorts naming questions first and caps them at 2 of the 3 slots', () => {
    const result = scopeCaptureQuestions(
      [
        q({ id: 'highlight' }),
        q({ id: 'n1', characterId: 'adult_1' }),
        q({ id: 'n2', characterId: 'adult_2' }),
        q({ id: 'n3', characterId: 'pet_1' }),
      ],
      [
        mainChild,
        character({}),
        character({ characterId: 'adult_2', role: 'parent' }),
        character({ characterId: 'pet_1', role: 'pet' }),
      ],
    );
    // Two naming slots, then the highlight question survives.
    expect(result.map(x => x.id)).toEqual(['n1', 'n2', 'highlight']);
  });

  it('lets overflow naming questions refill trailing slots when no other kinds exist', () => {
    const result = scopeCaptureQuestions(
      [
        q({ id: 'n1', characterId: 'adult_1' }),
        q({ id: 'n2', characterId: 'adult_2' }),
        q({ id: 'n3', characterId: 'pet_1' }),
      ],
      [
        mainChild,
        character({}),
        character({ characterId: 'adult_2', role: 'parent' }),
        character({ characterId: 'pet_1', role: 'pet' }),
      ],
    );
    expect(result.map(x => x.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('caps the total at 3 questions', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'q1' }), q({ id: 'q2' }), q({ id: 'q3' }), q({ id: 'q4' })],
      [mainChild],
    );
    expect(result.map(x => x.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('drops all naming questions when the roster has no main child (cannot verify scoping)', () => {
    const result = scopeCaptureQuestions(
      [q({ id: 'n1', characterId: 'adult_1' }), q({ id: 'other' })],
      [character({})],
    );
    expect(result.map(x => x.id)).toEqual(['other']);
  });
});
