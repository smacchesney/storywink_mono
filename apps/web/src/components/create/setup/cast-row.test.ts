import { describe, it, expect } from 'vitest';
import {
  CAST_RESERVE_MIN_HEIGHT,
  EVERYONE_FLASH_MS,
  STAR_BURST_MS,
  castMembers,
  castFaceSrc,
  castPhase,
  displayStarId,
  memberDisplayName,
  needsName,
  starPickableIds,
  upsertNameAnswer,
} from './cast-row';

const pages = [
  {
    assetId: 'a1',
    asset: {
      url: 'https://res.cloudinary.com/d/image/upload/v1/a1.jpg',
      thumbnailUrl: 'https://res.cloudinary.com/d/image/upload/v1/t1.jpg',
    },
  },
];
const kid = (id: string, n: number, extra = {}) => ({
  characterId: id,
  role: 'sibling',
  isForeground: true,
  appearsOnPages: Array.from({ length: n }, (_, i) => i + 1),
  appearsOnAssetIds: ['a1'],
  ...extra,
});

describe('castMembers', () => {
  it('keeps foreground people+pets, drops companion_object and background figures', () => {
    const roster = [
      kid('child_1', 3),
      { characterId: 'object_1', role: 'companion_object', appearsOnPages: [1, 2] },
      { characterId: 'child_5', role: 'friend', isForeground: false, appearsOnPages: [1] },
      { characterId: 'pet_1', role: 'pet', isForeground: true, appearsOnPages: [1, 2] },
    ];
    expect(castMembers(roster).map((m) => m.characterId)).toEqual(['child_1', 'pet_1']);
  });
  it('orders recurring kids first by photo count, then other foreground members', () => {
    const roster = [
      {
        characterId: 'adult_2',
        role: 'aunt_or_uncle',
        isForeground: true,
        appearsOnPages: [1, 2, 3, 4, 5, 6],
      },
      kid('child_1', 10),
      kid('child_2', 5),
    ];
    expect(castMembers(roster).map((m) => m.characterId)).toEqual([
      'child_1',
      'child_2',
      'adult_2',
    ]);
  });
});

describe('castFaceSrc', () => {
  it('uses the faceBox asset url when resolvable', () => {
    const src = castFaceSrc(
      kid('c1', 2, { faceBox: { pageNumber: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2, assetId: 'a1' } }),
      pages,
    );
    expect(src).toContain('c_crop');
  });
  it('falls back to a g_face thumb of the clearest photo when faceBox is absent (legacy)', () => {
    expect(castFaceSrc(kid('c1', 2), pages)).toContain('g_face');
  });
  it('returns null when no photo resolves (face renders as initial-less placeholder circle)', () => {
    expect(castFaceSrc(kid('c1', 2, { appearsOnAssetIds: ['gone'] }), [])).toBeNull();
  });
  it('dedupes fallback crops: the second member on the same photos takes the next free asset', () => {
    const twoPages = [
      {
        assetId: 'a1',
        asset: { url: 'https://res.cloudinary.com/d/image/upload/v1/a1.jpg', thumbnailUrl: null },
      },
      {
        assetId: 'a2',
        asset: { url: 'https://res.cloudinary.com/d/image/upload/v1/a2.jpg', thumbnailUrl: null },
      },
    ];
    const used = new Set<string>();
    const first = castFaceSrc(kid('c1', 2, { appearsOnAssetIds: ['a1', 'a2'] }), twoPages, used);
    const second = castFaceSrc(kid('c2', 2, { appearsOnAssetIds: ['a1', 'a2'] }), twoPages, used);
    expect(first).toContain('/a1.jpg');
    expect(second).toContain('/a2.jpg');
    expect(second).not.toBe(first);
  });
  it('shares a crop only when no alternative exists (never null over a duplicate)', () => {
    const used = new Set<string>();
    const first = castFaceSrc(kid('c1', 2), pages, used); // only a1 resolvable
    const second = castFaceSrc(kid('c2', 2), pages, used);
    expect(second).toBe(first);
  });
});

describe('displayStarId + childName display chain', () => {
  it('picked star wins; ensemble mode has no display star', () => {
    const members = [kid('a', 2), kid('b', 2)];
    expect(displayStarId({ starCharacterId: 'b', castMode: 'star', members })).toBe('b');
    expect(displayStarId({ starCharacterId: 'b', castMode: 'ensemble', members })).toBeNull();
  });
  it('solo book: the sole recurring kid is the display star with no pick', () => {
    const members = [
      kid('a', 2),
      { characterId: 'adult_1', role: 'parent', isForeground: true, appearsOnPages: [1, 2] },
    ];
    expect(displayStarId({ starCharacterId: null, castMode: 'star', members })).toBe('a');
  });
  it('two unpicked recurring kids: no display star yet (the ask is still open)', () => {
    expect(
      displayStarId({
        starCharacterId: null,
        castMode: 'star',
        members: [kid('a', 2), kid('b', 2)],
      }),
    ).toBeNull();
  });
  it('star face displays childName and needs no name — display-only', () => {
    expect(memberDisplayName(kid('a', 2), [], { isStar: true, childName: ' Kai ' })).toBe('Kai');
    expect(needsName(kid('a', 2), [], { isStar: true, childName: 'Kai' })).toBe(false);
    // committed answers still outrank childName (mirrors mergeCastNames precedence, Task 3)
    expect(
      memberDisplayName(
        kid('a', 2),
        [{ id: 'q1', question: 'x', options: [], characterId: 'a', answer: 'Astrid' }],
        { isStar: true, childName: 'Kai' },
      ),
    ).toBe('Astrid');
    // non-star faces never borrow childName
    expect(memberDisplayName(kid('b', 2), [], { isStar: false, childName: 'Kai' })).toBeNull();
    expect(needsName(kid('b', 2), [], { isStar: false, childName: 'Kai' })).toBe(true);
  });
});

describe('starPickableIds', () => {
  it('only recurring kids can become the star', () => {
    const members = [
      kid('a', 2),
      { characterId: 'adult_1', role: 'parent', isForeground: true, appearsOnPages: [1, 2, 3] },
      { characterId: 'pet_1', role: 'pet', isForeground: true, appearsOnPages: [1, 2] },
    ];
    expect(Array.from(starPickableIds(members))).toEqual(['a']);
  });
});

describe('spec constants', () => {
  it('pins the UX-spec numbers (anatomy sum 168, 2s flash, one 1.4s wink cycle)', () => {
    expect(CAST_RESERVE_MIN_HEIGHT).toBe(168);
    expect(EVERYONE_FLASH_MS).toBe(2000);
    expect(STAR_BURST_MS).toBe(1400);
  });
});

describe('castPhase', () => {
  it('star-ask only with 2+ recurring kids, star mode, no star picked', () => {
    expect(
      castPhase({
        members: [kid('a', 2), kid('b', 2)],
        recurringKidCount: 2,
        castMode: 'star',
        starCharacterId: null,
        reading: false,
      }),
    ).toBe('star-ask');
  });
  it('single-kid and solo books go straight to naming', () => {
    expect(
      castPhase({
        members: [kid('a', 2)],
        recurringKidCount: 1,
        castMode: 'star',
        starCharacterId: null,
        reading: false,
      }),
    ).toBe('naming');
  });
  it('reading while roster empty; hidden once settled empty', () => {
    expect(
      castPhase({
        members: [],
        recurringKidCount: 0,
        castMode: 'star',
        starCharacterId: null,
        reading: true,
      }),
    ).toBe('reading');
    expect(
      castPhase({
        members: [],
        recurringKidCount: 0,
        castMode: 'star',
        starCharacterId: null,
        reading: false,
      }),
    ).toBe('hidden');
  });
});

describe('needsName + upsertNameAnswer', () => {
  it('needsName: unnamed roster member with no committed answer', () => {
    expect(needsName(kid('c1', 2), [])).toBe(true);
    expect(needsName(kid('c1', 2, { name: 'Kai' }), [])).toBe(false);
    expect(
      needsName(kid('c1', 2), [
        { id: 'q2', question: 'x', options: [], characterId: 'c1', answer: 'Kai' },
      ]),
    ).toBe(false);
  });
  it('reuses an existing row for the characterId, else mints name_<id>', () => {
    const rows = [
      {
        id: 'q2',
        question: 'Who?',
        options: ['Daddy'],
        characterId: 'c1',
        kind: 'naming' as const,
        answer: null,
      },
    ];
    const updated = upsertNameAnswer(rows, kid('c1', 2), 'Kai', () => 'unused');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ id: 'q2', answer: 'Kai' });
    const minted = upsertNameAnswer([], kid('c9', 2), 'Mia', (d) => `What should we call ${d}?`);
    expect(minted[0]).toMatchObject({
      id: 'name_c9',
      characterId: 'c9',
      kind: 'naming',
      answer: 'Mia',
    });
  });
  it('empty commit clears an earlier answer, never deletes the row', () => {
    const rows = [
      {
        id: 'name_c1',
        question: 'x',
        options: [],
        characterId: 'c1',
        kind: 'naming' as const,
        answer: 'Kai',
      },
    ];
    expect(upsertNameAnswer(rows, kid('c1', 2), '', () => 'q')[0].answer).toBeNull();
  });
});
