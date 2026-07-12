import { describe, it, expect } from 'vitest';
import {
  buildAvatarCastForPrompt,
  describeCastMember,
  extractAvatarScene,
  orderCharacterSheets,
  avatarStoryQcProblems,
} from './avatar-story.js';

describe('describeCastMember', () => {
  it('composes hair, feature, and clothing into one line', () => {
    expect(
      describeCastMember({
        physicalTraits: { hairColor: 'curly brown', distinguishingFeatures: ['round glasses'] },
        typicalClothing: 'yellow raincoat',
      }),
    ).toBe('curly brown hair, round glasses, yellow raincoat');
  });

  it('skips "none" clothing and returns undefined when nothing is known', () => {
    expect(describeCastMember({ typicalClothing: 'none' })).toBeUndefined();
    expect(describeCastMember({})).toBeUndefined();
  });
});

describe('buildAvatarCastForPrompt', () => {
  it('maps stored roster entries to prompt cast members', () => {
    const cast = buildAvatarCastForPrompt([
      {
        characterId: 'avatar_1',
        role: 'main_child',
        name: 'Emma',
        physicalTraits: { hairColor: 'brown', distinguishingFeatures: [] },
        typicalClothing: 'striped tee',
      },
      { characterId: 'avatar_2', role: 'pet', name: 'Biscuit' },
    ]);
    expect(cast).toEqual([
      {
        characterId: 'avatar_1',
        name: 'Emma',
        role: 'main_child',
        description: 'brown hair, striped tee',
      },
      { characterId: 'avatar_2', name: 'Biscuit', role: 'pet', description: undefined },
    ]);
  });

  it('drops entries without a characterId or a name and defaults blank roles', () => {
    const cast = buildAvatarCastForPrompt([
      { characterId: '', name: 'Ghost' },
      { characterId: 'avatar_3', name: '  ' },
      { characterId: 'avatar_4', name: 'Auntie', role: '' },
      null as unknown as { characterId: string },
    ].filter(Boolean) as Parameters<typeof buildAvatarCastForPrompt>[0]);
    expect(cast).toEqual([
      { characterId: 'avatar_4', name: 'Auntie', role: 'grown-up', description: undefined },
    ]);
  });

  it('tolerates a null roster', () => {
    expect(buildAvatarCastForPrompt(null)).toEqual([]);
    expect(buildAvatarCastForPrompt(undefined)).toEqual([]);
  });
});

describe('extractAvatarScene', () => {
  const validScene = {
    location: 'the rainy garden',
    timeOfDay: 'morning',
    action: 'searching under the big leaf',
    charactersPresent: ['avatar_1', 'avatar_2'],
    props: ['red umbrella'],
  };

  it('accepts a valid scene verbatim', () => {
    expect(extractAvatarScene(validScene, ['avatar_1', 'avatar_2'])).toEqual(validScene);
  });

  it('drops unknown characterIds but keeps the scene', () => {
    const scene = extractAvatarScene(
      { ...validScene, charactersPresent: ['avatar_1', 'made_up_9'] },
      ['avatar_1', 'avatar_2'],
    );
    expect(scene?.charactersPresent).toEqual(['avatar_1']);
    expect(scene?.location).toBe('the rainy garden');
  });

  it('returns null for malformed scenes (never throws)', () => {
    expect(extractAvatarScene(null, ['avatar_1'])).toBeNull();
    expect(extractAvatarScene({ location: '' }, ['avatar_1'])).toBeNull();
    expect(extractAvatarScene({ ...validScene, outfitFrom: 'previous' }, ['avatar_1'])).not.toBeNull();
  });

  it('tolerates an empty charactersPresent (wide establishing shot)', () => {
    const scene = extractAvatarScene({ ...validScene, charactersPresent: [] }, ['avatar_1']);
    expect(scene?.charactersPresent).toEqual([]);
  });
});

describe('orderCharacterSheets', () => {
  const sheets = [
    { characterId: 'avatar_3', url: 'c' },
    { characterId: 'avatar_1', url: 'a' },
    { characterId: 'avatar_2', url: 'b' },
  ];

  it('star first, then roster (pick) order — image 1 is always the star', () => {
    expect(orderCharacterSheets(sheets, 'avatar_2').map(s => s.characterId)).toEqual([
      'avatar_2',
      'avatar_1',
      'avatar_3',
    ]);
  });

  it('no star (adult-only cast) → deterministic roster order, never DB order', () => {
    expect(orderCharacterSheets(sheets, null).map(s => s.characterId)).toEqual([
      'avatar_1',
      'avatar_2',
      'avatar_3',
    ]);
  });

  it('numeric-aware: avatar_10 sorts after avatar_2', () => {
    const wide = [{ characterId: 'avatar_10' }, { characterId: 'avatar_2' }];
    expect(orderCharacterSheets(wide, null).map(s => s.characterId)).toEqual([
      'avatar_2',
      'avatar_10',
    ]);
  });

  it('a star id missing from the sheets degrades to roster order', () => {
    expect(orderCharacterSheets(sheets, 'avatar_9').map(s => s.characterId)).toEqual([
      'avatar_1',
      'avatar_2',
      'avatar_3',
    ]);
  });
});

describe('avatarStoryQcProblems', () => {
  const passing = { arcCoherence: 9, readAloudRhythm: 8, lastPageLanding: true, feedback: null };

  it('passes clean drafts', () => {
    expect(avatarStoryQcProblems(passing, 'drip drop off we go', 5)).toEqual([]);
  });

  it('enforces refrain, arc, rhythm, and landing', () => {
    const problems = avatarStoryQcProblems(
      { arcCoherence: 4, readAloudRhythm: 5, lastPageLanding: false, feedback: '1. Fix it.' },
      'drip drop',
      1,
    );
    expect(problems).toHaveLength(5); // 4 failures + appended feedback
    expect(problems.some(p => p.includes('refrain'))).toBe(true);
    expect(problems.at(-1)).toBe('1. Fix it.');
  });

  it('premiseTruth is LOG-ONLY by construction — no score can block the draft', () => {
    // The verdict function does not even accept premiseTruth: a 0/10 premise
    // score can never trigger the silent extra generation.
    const qcWithTerriblePremise = { ...passing, premiseTruth: 0 } as typeof passing & {
      premiseTruth: number;
    };
    expect(avatarStoryQcProblems(qcWithTerriblePremise, 'drip drop off we go', 5)).toEqual([]);
  });

  it('model feedback only rides along when something enforced failed', () => {
    expect(
      avatarStoryQcProblems({ ...passing, feedback: 'nitpicks' }, 'drip drop off we go', 5),
    ).toEqual([]);
  });
});
