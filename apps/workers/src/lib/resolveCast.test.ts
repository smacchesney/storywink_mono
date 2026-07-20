import { describe, it, expect } from 'vitest';
import {
  mergeCastNames,
  checkCastNameCoverage,
  checkCastPageConflicts,
  computeCastBalance,
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
      captureQuestions: [{ id: 'q1', characterId: 'adult_1', answer: 'Grandma' }],
      childName: 'Emma',
    });
    const grandma = result.characters.find((c) => c.characterId === 'adult_1')!;
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
    expect(result.characters.every((c) => c.name === null)).toBe(true);
  });

  it('never guesses on a failed join, even with a single unnamed candidate (unnamed beats misnamed)', () => {
    // The person the chip asked about may have been removed with their
    // photos — their name must not land on whoever happens to remain.
    const result = mergeCastNames({
      characters: [mainChild, character({ characterId: 'adult_2', role: 'parent' })],
      captureQuestions: [{ id: 'q1', characterId: 'adult_1', answer: 'Grandma' }],
      childName: null,
    });
    const remaining = result.characters.find((c) => c.characterId === 'adult_2')!;
    expect(remaining.name).toBeNull();
    expect(result.consumedQuestionIds).toEqual([]);
  });

  it('treats a generic-category answer as role refinement, never a name (still consumed)', () => {
    const result = mergeCastNames({
      characters: [mainChild, character({ role: 'adult' })],
      captureQuestions: [{ id: 'q1', characterId: 'adult_1', answer: 'Family friend' }],
      childName: null,
    });
    const friend = result.characters.find((c) => c.characterId === 'adult_1')!;
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
    const pet = result.characters.find((c) => c.characterId === 'pet_1')!;
    expect(pet.name).toBe('Our dog');
    expect(pet.namedVia).toBe('chip');
  });

  it('refines a pet\'s role for a generic pet category ("A friend\'s cat")', () => {
    const result = mergeCastNames({
      characters: [mainChild, character({ characterId: 'pet_1', role: 'pet' })],
      captureQuestions: [{ id: 'q1', characterId: 'pet_1', answer: "A friend's cat" }],
      childName: null,
    });
    const pet = result.characters.find((c) => c.characterId === 'pet_1')!;
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

  it('a chip answer on the main child now wins over childName (P0a)', () => {
    const result = mergeCastNames({
      characters: [mainChild],
      captureQuestions: [{ id: 'q1', characterId: 'child_1', answer: 'Grandma' }],
      childName: 'Emma',
    });
    expect(result.characters[0].name).toBe('Grandma');
    expect(result.characters[0].namedVia).toBe('chip');
    expect(result.consumedQuestionIds).toEqual(['q1']);
    expect(result.skippedDuplicates).toHaveLength(1);
    expect(result.skippedDuplicates[0]).toMatchObject({ source: 'childName' });
  });

  it('reports changed=false when the merge is a no-op (already merged)', () => {
    const result = mergeCastNames({
      characters: [
        character({
          characterId: 'child_1',
          role: 'main_child',
          name: 'Emma',
          namedVia: 'childName',
        }),
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
  it.each([
    'Family friend',
    'a friend',
    'Neighbour',
    "A friend's dog",
    'ともだちの ねこ',
    'しりあい',
  ])('flags %s as generic', (answer) => expect(isGenericCategoryAnswer(answer)).toBe(true));

  it.each(['Grandma', 'Auntie Mei', 'Our dog', "Grandma's dog", 'おばあちゃん', 'Rex'])(
    'keeps %s as a usable name',
    (answer) => expect(isGenericCategoryAnswer(answer)).toBe(false),
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

describe('mergeCastNames — companion objects', () => {
  const bunny = character({ characterId: 'object_1', role: 'companion_object' });

  it('a typed special name lands on the object entry and is consumed', () => {
    const result = mergeCastNames({
      characters: [mainChild, bunny],
      captureQuestions: [{ id: 'q2', characterId: 'object_1', answer: 'Mr. Hoppy' }],
      childName: 'Mia',
    });
    const obj = result.characters.find((c) => c.characterId === 'object_1')!;
    expect(obj.name).toBe('Mr. Hoppy');
    expect(obj.namedVia).toBe('chip');
    expect(result.consumedQuestionIds).toEqual(['q2']);
  });

  it('a generic-category word on an object question becomes its NAME, never a role rewrite', () => {
    const result = mergeCastNames({
      characters: [bunny],
      captureQuestions: [{ id: 'q1', characterId: 'object_1', answer: 'Teacher' }],
      childName: null,
    });
    const obj = result.characters.find((c) => c.characterId === 'object_1')!;
    expect(obj.role).toBe('companion_object');
    expect(obj.name).toBe('Teacher');
    expect(obj.namedVia).toBe('chip');
  });
});

describe('computeCastBalance (X17 A2)', () => {
  const texts = ['Leo runs.', 'Maya and Leo splash.', 'Everyone rests.'];

  it('counts text pages per confirmed-named member vs photo pages', () => {
    expect(
      computeCastBalance(
        [
          { name: 'Leo', role: 'main_child', namedVia: 'childName', appearsOnPages: [1, 2] },
          { name: 'Maya', role: 'sibling', namedVia: 'chip', appearsOnPages: [2, 3] },
        ],
        texts,
      ),
    ).toEqual([
      { name: 'Leo', role: 'main_child', textPages: 2, photoPages: 2 },
      { name: 'Maya', role: 'sibling', textPages: 1, photoPages: 2 },
    ]);
  });

  it('skips role-fallback names; script-gates uncheckable names to textPages null', () => {
    expect(
      computeCastBalance(
        [
          { name: 'grandparent', role: 'grandparent', appearsOnPages: [1] },
          { name: '太郎', role: 'sibling', namedVia: 'chip', appearsOnPages: [1] },
        ],
        texts,
        'en',
      ),
    ).toEqual([{ name: '太郎', role: 'sibling', textPages: null, photoPages: 1 }]);
  });
});

describe('X17.2 — checkCastPageConflicts', () => {
  const cast = [
    { name: 'Uncle Jon', role: 'aunt_or_uncle', namedVia: 'chip' as const, appearsOnPages: [1, 3] },
    { name: 'Asher', role: 'sibling', namedVia: 'chip' as const, appearsOnPages: [2] },
  ];
  it('flags a page mentioning a member who is not there (outside ±1)', () => {
    const conflicts = checkCastPageConflicts(cast, [
      'Uncle Jon laughs.', // p1: on-page — fine
      'A quiet ride.', // p2
      'The horses gleam.', // p3
      'A gentle hush.', // p4
      'Uncle Jon cheers from far away.', // p5: pages [1,3] ±1 → conflict
    ]);
    expect(conflicts).toEqual([
      { pageNumber: 5, name: 'Uncle Jon', issue: expect.stringContaining('Uncle Jon') },
    ]);
  });
  it('±1 tolerance and page-less entries are never flagged', () => {
    expect(
      checkCastPageConflicts(cast, ['x', 'Uncle Jon waves.', 'y']), // p2 is within ±1 of p1/p3
    ).toEqual([]);
    expect(
      checkCastPageConflicts(
        [{ name: 'Mia', role: 'friend', namedVia: 'chip' as const, appearsOnPages: [] }],
        ['Mia everywhere.'],
      ),
    ).toEqual([]);
  });
  it('script-gated like coverage (kanji names skipped)', () => {
    expect(
      checkCastPageConflicts(
        [{ name: '太郎', role: 'friend', namedVia: 'chip' as const, appearsOnPages: [1] }],
        ['x', 'y'],
      ),
    ).toEqual([]);
  });
});

describe('star binding (X17 A2)', () => {
  const roster = (): MergeableCharacter[] => [
    { characterId: 'child_1', role: 'main_child', name: null },
    { characterId: 'child_2', role: 'sibling', name: null },
  ];

  it('binds childName to starCharacterId when present', () => {
    const { characters, changed } = mergeCastNames({
      characters: roster(),
      captureQuestions: [],
      childName: 'Maya',
      starCharacterId: 'child_2',
    });
    expect(changed).toBe(true);
    expect(characters.find((c) => c.characterId === 'child_2')).toMatchObject({
      name: 'Maya',
      namedVia: 'childName',
    });
    expect(characters.find((c) => c.characterId === 'child_1')?.name).toBeNull();
  });

  it('falls back to main_child when starCharacterId is stale or absent', () => {
    const stale = mergeCastNames({
      characters: roster(),
      captureQuestions: [],
      childName: 'Maya',
      starCharacterId: 'ghost_9',
    });
    expect(stale.characters.find((c) => c.role === 'main_child')?.name).toBe('Maya');
    const absent = mergeCastNames({
      characters: roster(),
      captureQuestions: [],
      childName: 'Maya',
    });
    expect(absent.characters.find((c) => c.role === 'main_child')?.name).toBe('Maya');
  });

  it('a naming chip may now name the demoted main_child', () => {
    const { characters, consumedQuestionIds } = mergeCastNames({
      characters: roster(),
      captureQuestions: [{ id: 'q1', answer: 'Leo', characterId: 'child_1' }],
      childName: 'Maya',
      starCharacterId: 'child_2',
    });
    expect(characters.find((c) => c.characterId === 'child_1')).toMatchObject({
      name: 'Leo',
      namedVia: 'chip',
    });
    expect(consumedQuestionIds).toEqual(['q1']);
  });

  it('a chip aimed at the star wins and is consumed (P0a)', () => {
    const { characters, consumedQuestionIds } = mergeCastNames({
      characters: roster(),
      captureQuestions: [{ id: 'q1', answer: 'Bobby', characterId: 'child_2' }],
      childName: 'Maya',
      starCharacterId: 'child_2',
    });
    expect(characters.find((c) => c.characterId === 'child_2')?.name).toBe('Bobby');
    expect(characters.find((c) => c.characterId === 'child_2')?.namedVia).toBe('chip');
    expect(consumedQuestionIds).toEqual(['q1']);
  });
});

describe('X17.2 P0a — chip precedence + duplicate invariant', () => {
  const roster = (): MergeableCharacter[] => [
    { characterId: 'child_1', role: 'main_child', name: null },
    { characterId: 'child_2', role: 'sibling', name: null },
    { characterId: 'adult_1', role: 'parent', name: null },
  ];

  it('replays the two-Kais book: chip Astrid survives, childName skips as duplicate', () => {
    const result = mergeCastNames({
      characters: roster(),
      captureQuestions: [
        { id: 'q2', answer: 'Kai', characterId: 'child_2' },
        { id: 'ramble_name_child_1', answer: 'Astrid', characterId: 'child_1' },
      ],
      childName: 'Kai',
      starCharacterId: null, // ensemble book — starTarget falls back to main_child
    });
    const byId = Object.fromEntries(result.characters.map((c) => [c.characterId, c]));
    expect(byId.child_1.name).toBe('Astrid');
    expect(byId.child_1.namedVia).toBe('chip');
    expect(byId.child_2.name).toBe('Kai');
    const names = result.characters.map((c) => c.name).filter(Boolean);
    expect(new Set(names).size).toBe(names.length); // hard invariant
    expect(result.skippedDuplicates).toEqual([
      { characterId: 'child_1', name: 'Kai', claimedByCharacterId: 'child_2', source: 'childName' },
    ]);
    expect(result.consumedQuestionIds).toEqual(['q2', 'ramble_name_child_1']);
  });

  it('childName still binds when the star is chip-unnamed and the name is unclaimed (legacy path)', () => {
    const result = mergeCastNames({
      characters: roster(),
      captureQuestions: [{ id: 'q1', answer: 'Grandma', characterId: 'adult_1' }],
      childName: 'Mia',
      starCharacterId: null,
    });
    const star = result.characters.find((c) => c.characterId === 'child_1')!;
    expect(star.name).toBe('Mia');
    expect(star.namedVia).toBe('childName');
    expect(result.skippedDuplicates).toEqual([]);
  });

  it('a chip on the star target wins over childName and is consumed', () => {
    const result = mergeCastNames({
      characters: roster(),
      captureQuestions: [{ id: 'q9', answer: 'Astrid', characterId: 'child_1' }],
      childName: 'Kai',
      starCharacterId: 'child_1',
    });
    const star = result.characters.find((c) => c.characterId === 'child_1')!;
    expect(star.name).toBe('Astrid');
    expect(star.namedVia).toBe('chip');
    expect(result.consumedQuestionIds).toContain('q9');
  });

  it('second chip with an already-claimed name is skipped, unconsumed, and reported', () => {
    const result = mergeCastNames({
      characters: roster(),
      captureQuestions: [
        { id: 'qA', answer: 'Kai', characterId: 'child_2' },
        { id: 'qB', answer: 'kai ', characterId: 'adult_1' }, // case/space-insensitive
      ],
      childName: null,
    });
    expect(result.characters.find((c) => c.characterId === 'adult_1')!.name).toBeNull();
    expect(result.consumedQuestionIds).toEqual(['qA']);
    expect(result.skippedDuplicates[0]).toMatchObject({ characterId: 'adult_1', source: 'chip' });
  });

  it('underscore tokens refine the role, never become a name (dump: parent_or_uncle)', () => {
    const result = mergeCastNames({
      characters: roster(),
      captureQuestions: [{ id: 'r1', answer: 'parent_or_uncle', characterId: 'adult_1' }],
      childName: null,
    });
    const adult = result.characters.find((c) => c.characterId === 'adult_1')!;
    expect(adult.name).toBeNull();
    expect(adult.role).toBe('parent or uncle');
  });

  it('is byte-identical for conflict-free legacy books', () => {
    const input = {
      characters: roster(),
      captureQuestions: [{ id: 'q1', answer: 'Grandma', characterId: 'adult_1' }],
      childName: 'Kai',
      starCharacterId: null,
    };
    const result = mergeCastNames(input);
    expect(result.characters).toEqual([
      { characterId: 'child_1', role: 'main_child', name: 'Kai', namedVia: 'childName' },
      { characterId: 'child_2', role: 'sibling', name: null },
      { characterId: 'adult_1', role: 'parent', name: 'Grandma', namedVia: 'chip' },
    ]);
  });
});
