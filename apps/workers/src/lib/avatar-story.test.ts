import { describe, it, expect } from 'vitest';
import {
  buildAvatarCastForPrompt,
  describeCastMember,
  extractAvatarScene,
  orderCharacterSheets,
  selectSceneSheets,
  avatarStoryQcProblems,
  reconcileSceneCastWithText,
} from './avatar-story.js';
import type { AvatarPageScene } from '@storywink/shared/prompts/story';

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
    const cast = buildAvatarCastForPrompt(
      [
        { characterId: '', name: 'Ghost' },
        { characterId: 'avatar_3', name: '  ' },
        { characterId: 'avatar_4', name: 'Auntie', role: '' },
        null as unknown as { characterId: string },
      ].filter(Boolean) as Parameters<typeof buildAvatarCastForPrompt>[0],
    );
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

  it('accepts a valid scene, defaulting the L1 meaning channel to null', () => {
    // X13 Track L: mood/focus are absent here, so the zod layer defaults them to
    // null (degrade-safe) rather than dropping the scene.
    expect(extractAvatarScene(validScene, ['avatar_1', 'avatar_2'])).toEqual({
      ...validScene,
      mood: null,
      focus: null,
    });
  });

  it('carries mood + focus through extraction when the model authors them (BLOCKER fix)', () => {
    const scene = extractAvatarScene(
      { ...validScene, mood: 'hushed wonder', focus: 'Emma reaching for the latch' },
      ['avatar_1', 'avatar_2'],
    );
    expect(scene?.mood).toBe('hushed wonder');
    expect(scene?.focus).toBe('Emma reaching for the latch');
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
    expect(
      extractAvatarScene({ ...validScene, outfitFrom: 'previous' }, ['avatar_1']),
    ).not.toBeNull();
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
    expect(orderCharacterSheets(sheets, 'avatar_2').map((s) => s.characterId)).toEqual([
      'avatar_2',
      'avatar_1',
      'avatar_3',
    ]);
  });

  it('no star (adult-only cast) → deterministic roster order, never DB order', () => {
    expect(orderCharacterSheets(sheets, null).map((s) => s.characterId)).toEqual([
      'avatar_1',
      'avatar_2',
      'avatar_3',
    ]);
  });

  it('numeric-aware: avatar_10 sorts after avatar_2', () => {
    const wide = [{ characterId: 'avatar_10' }, { characterId: 'avatar_2' }];
    expect(orderCharacterSheets(wide, null).map((s) => s.characterId)).toEqual([
      'avatar_2',
      'avatar_10',
    ]);
  });

  it('a star id missing from the sheets degrades to roster order', () => {
    expect(orderCharacterSheets(sheets, 'avatar_9').map((s) => s.characterId)).toEqual([
      'avatar_1',
      'avatar_2',
      'avatar_3',
    ]);
  });
});

describe('selectSceneSheets — send only the scene cast, star floor, cap 4', () => {
  // avatar_1 is the star; avatar_2..avatar_6 are supporting cast.
  const sheets = [
    { characterId: 'avatar_4', url: 'd' },
    { characterId: 'avatar_1', url: 'a' },
    { characterId: 'avatar_6', url: 'f' },
    { characterId: 'avatar_2', url: 'b' },
    { characterId: 'avatar_5', url: 'e' },
    { characterId: 'avatar_3', url: 'c' },
  ];
  const ids = (out: { characterId: string }[]) => out.map((s) => s.characterId);

  it('keeps only the present cast, star first', () => {
    const out = selectSceneSheets(sheets, {
      charactersPresent: ['avatar_3', 'avatar_1'],
      starCharacterId: 'avatar_1',
    });
    expect(ids(out)).toEqual(['avatar_1', 'avatar_3']);
  });

  it('always includes the star as image 1 even when the scene omits it', () => {
    const out = selectSceneSheets(sheets, {
      charactersPresent: ['avatar_2', 'avatar_5'],
      starCharacterId: 'avatar_1',
    });
    expect(ids(out)).toEqual(['avatar_1', 'avatar_2', 'avatar_5']);
  });

  it('an empty cast (establishing shot) sends the star sheet only — never zero', () => {
    const out = selectSceneSheets(sheets, {
      charactersPresent: [],
      starCharacterId: 'avatar_1',
    });
    expect(ids(out)).toEqual(['avatar_1']);
  });

  it('caps at 4 total — star + the first 3 others in deterministic order', () => {
    const out = selectSceneSheets(sheets, {
      charactersPresent: ['avatar_6', 'avatar_5', 'avatar_4', 'avatar_3', 'avatar_2'],
      starCharacterId: 'avatar_1',
    });
    expect(ids(out)).toEqual(['avatar_1', 'avatar_2', 'avatar_3', 'avatar_4']);
    expect(out).toHaveLength(4);
  });

  it('skips unresolvable present ids that have no sheet, keeping the star floor', () => {
    const out = selectSceneSheets(sheets, {
      charactersPresent: ['ghost_9', 'avatar_2'],
      starCharacterId: 'avatar_1',
    });
    expect(ids(out)).toEqual(['avatar_1', 'avatar_2']);
  });

  it('an empty cast with no star still floors to one sheet (roster-first)', () => {
    const out = selectSceneSheets(sheets, {
      charactersPresent: [],
      starCharacterId: null,
    });
    expect(ids(out)).toEqual(['avatar_1']);
  });

  it('a null scene (validation failed) sends every sheet, ordered, no filter', () => {
    const out = selectSceneSheets(sheets, {
      charactersPresent: null,
      starCharacterId: 'avatar_1',
    });
    expect(ids(out)).toEqual([
      'avatar_1',
      'avatar_2',
      'avatar_3',
      'avatar_4',
      'avatar_5',
      'avatar_6',
    ]);
  });

  it('present ids resolving to zero sheets, no star → floors to roster-first', () => {
    const out = selectSceneSheets(sheets, {
      charactersPresent: ['ghost_1', 'ghost_2'],
      starCharacterId: null,
    });
    expect(ids(out)).toEqual(['avatar_1']);
  });
});

describe('reconcileSceneCastWithText — union-repair scene cast from page text', () => {
  const roster = [
    { characterId: 'kai', name: 'Kai' },
    { characterId: 'grypho', name: 'Grypho' },
    { characterId: 'kaito', name: 'Kaito' },
  ];
  const scene = (charactersPresent: string[]): AvatarPageScene => ({
    location: 'the misty ridge',
    timeOfDay: 'morning',
    action: 'climbing toward the summit',
    charactersPresent,
    props: ['lantern'],
  });

  it('adds a text-named character the scene dropped (union), roster order appended', () => {
    const out = reconcileSceneCastWithText(
      scene(['kai']),
      'Kai and Grypho scramble up the rocks.',
      roster,
    );
    expect(out.scene.charactersPresent).toEqual(['kai', 'grypho']);
    expect(out.repair).toEqual({ addedIds: ['grypho'], textNames: ['Grypho'] });
  });

  it('is a no-op when the text names nobody new (repair null, same scene reference)', () => {
    const input = scene(['kai']);
    const out = reconcileSceneCastWithText(input, 'Up the quiet mountain they go.', roster);
    expect(out.repair).toBeNull();
    expect(out.scene).toBe(input);
  });

  it('is a no-op when every text-named character is already present', () => {
    const input = scene(['kai', 'grypho']);
    const out = reconcileSceneCastWithText(input, 'Kai and Grypho rest.', roster);
    expect(out.repair).toBeNull();
    expect(out.scene).toBe(input);
  });

  it('whole-word only: "Kai" does NOT false-match inside "Kaito"', () => {
    const out = reconcileSceneCastWithText(scene([]), 'Kaito waves hello.', roster);
    expect(out.scene.charactersPresent).toEqual(['kaito']);
    expect(out.repair).toEqual({ addedIds: ['kaito'], textNames: ['Kaito'] });
  });

  it('catches a possessive: "Kai’s lantern" names Kai', () => {
    const out = reconcileSceneCastWithText(scene([]), "Kai's lantern glows.", roster);
    expect(out.scene.charactersPresent).toEqual(['kai']);
    expect(out.repair).toEqual({ addedIds: ['kai'], textNames: ['Kai'] });
  });

  it('turns an establishing shot into a cast page when the text names a character', () => {
    const out = reconcileSceneCastWithText(scene([]), 'Grypho circles overhead.', roster);
    expect(out.scene.charactersPresent).toEqual(['grypho']);
    expect(out.repair).toEqual({ addedIds: ['grypho'], textNames: ['Grypho'] });
  });

  it('is case-insensitive', () => {
    const out = reconcileSceneCastWithText(scene([]), 'high above, GRYPHO soars.', roster);
    expect(out.scene.charactersPresent).toEqual(['grypho']);
  });

  it('preserves existing order, appends repairs in roster order', () => {
    const out = reconcileSceneCastWithText(
      scene(['grypho']),
      'Kaito and Kai wave up at Grypho.',
      roster,
    );
    // grypho already present (kept first); kai + kaito appended in roster order.
    expect(out.scene.charactersPresent).toEqual(['grypho', 'kai', 'kaito']);
    expect(out.repair).toEqual({ addedIds: ['kai', 'kaito'], textNames: ['Kai', 'Kaito'] });
  });

  it('union only — never removes an id the model kept that the text omits (establishing extras)', () => {
    const out = reconcileSceneCastWithText(
      scene(['kai', 'grypho']),
      'Kai looks around the empty ridge.',
      roster,
    );
    expect(out.scene.charactersPresent).toEqual(['kai', 'grypho']);
    expect(out.repair).toBeNull();
  });

  it('is idempotent — a second pass over a repaired scene makes no further change', () => {
    const once = reconcileSceneCastWithText(scene(['kai']), 'Kai and Grypho climb.', roster);
    const twice = reconcileSceneCastWithText(once.scene, 'Kai and Grypho climb.', roster);
    expect(twice.repair).toBeNull();
    expect(twice.scene).toBe(once.scene);
    expect(twice.scene.charactersPresent).toEqual(['kai', 'grypho']);
  });

  it('tolerates an empty roster (no names to match) as a no-op', () => {
    const input = scene(['kai']);
    const out = reconcileSceneCastWithText(input, 'Kai and Grypho climb.', []);
    expect(out.repair).toBeNull();
    expect(out.scene).toBe(input);
  });

  describe('capitalization guard — common-noun homographs never repair (X12-B review)', () => {
    const homographRoster = [
      { characterId: 'star_1', name: 'Star' },
      { characterId: 'biscuit_1', name: 'Biscuit' },
      { characterId: 'avatar_2', name: 'avatar_2' }, // characterId-fallback display name
    ];

    it('a bare-lowercase homograph does NOT repair: "the falling star" is not the child Star', () => {
      const input = scene([]);
      const out = reconcileSceneCastWithText(input, 'She wished on the falling star.', [
        homographRoster[0],
      ]);
      expect(out.repair).toBeNull();
      expect(out.scene).toBe(input);
    });

    it('an uppercase-first occurrence still repairs: "Star waved" names the character', () => {
      const out = reconcileSceneCastWithText(scene([]), 'Star waved from the hilltop.', [
        homographRoster[0],
      ]);
      expect(out.scene.charactersPresent).toEqual(['star_1']);
      expect(out.repair).toEqual({ addedIds: ['star_1'], textNames: ['Star'] });
    });

    it("the roster's exact spelling always matches — legitimately lowercase characterId fallbacks", () => {
      const out = reconcileSceneCastWithText(scene([]), 'Then avatar_2 hums along.', [
        homographRoster[2],
      ]);
      expect(out.scene.charactersPresent).toEqual(['avatar_2']);
      expect(out.repair).toEqual({ addedIds: ['avatar_2'], textNames: ['avatar_2'] });
    });

    it('accepted edge: a sentence-start homograph repairs — "Biscuit crumbs everywhere!" (same edge substituteCharacterNames lives with)', () => {
      const out = reconcileSceneCastWithText(scene([]), 'Biscuit crumbs everywhere!', [
        homographRoster[1],
      ]);
      expect(out.scene.charactersPresent).toEqual(['biscuit_1']);
      expect(out.repair).toEqual({ addedIds: ['biscuit_1'], textNames: ['Biscuit'] });
    });
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
    expect(problems.some((p) => p.includes('refrain'))).toBe(true);
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

  it('soundOverload + agency are LOG-ONLY on avatar by construction (S2/S3)', () => {
    // Neither is in the verdict Pick, so a sound-drenched, agency-less draft
    // still passes the avatar gate (photo enforces soundOverload; avatar logs).
    const qcWorstCase = { ...passing, soundOverload: true, agency: 0 } as typeof passing & {
      soundOverload: boolean;
      agency: number;
    };
    expect(avatarStoryQcProblems(qcWorstCase, 'drip drop off we go', 5)).toEqual([]);
  });

  it('model feedback only rides along when something enforced failed', () => {
    expect(
      avatarStoryQcProblems({ ...passing, feedback: 'nitpicks' }, 'drip drop off we go', 5),
    ).toEqual([]);
  });
});
