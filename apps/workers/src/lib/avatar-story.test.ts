import { describe, it, expect } from 'vitest';
import {
  buildAvatarCastForPrompt,
  describeCastMember,
  extractAvatarScene,
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
