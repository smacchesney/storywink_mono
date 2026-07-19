import { describe, it, expect, vi } from 'vitest';
import type { CharacterIdentity, CharacterDescription } from '@storywink/shared/types';
import { prepareIdentityForSheetPrewarm } from './sheet-prewarm.js';

function character(overrides: Partial<CharacterDescription> = {}): CharacterDescription {
  return {
    characterId: 'char_1',
    role: 'main_child',
    name: null,
    appearance: 'curly hair, red jacket',
    styleTranslation: 'soft vignette watercolor rendering',
    ...overrides,
  } as CharacterDescription;
}

function identity(overrides: Partial<CharacterIdentity> = {}): CharacterIdentity {
  return {
    characters: [character()],
    sceneContext: 'backyard afternoon',
    extractedForStyle: 'vignette',
    ...overrides,
  };
}

const refreshNever = vi.fn(async () => {
  throw new Error('refresh must not be called');
});

describe('prepareIdentityForSheetPrewarm (X15 fix layer)', () => {
  it('returns null (skip prep) when there is no identity or an empty roster', async () => {
    expect(
      await prepareIdentityForSheetPrewarm({
        identity: null,
        artStyle: 'vignette',
        captureQuestions: [],
        childName: null,
        starCharacterId: null,
        refresh: refreshNever,
      }),
    ).toBeNull();
    expect(
      await prepareIdentityForSheetPrewarm({
        identity: identity({ characters: [] }),
        artStyle: 'vignette',
        captureQuestions: [],
        childName: null,
        starCharacterId: null,
        refresh: refreshNever,
      }),
    ).toBeNull();
  });

  it('applies the capture-answer cast-name merge in memory (matching style: no refresh)', async () => {
    const refresh = vi.fn(async (i: CharacterIdentity) => i);
    const prepared = await prepareIdentityForSheetPrewarm({
      identity: identity({
        characters: [character({ characterId: 'char_2', role: 'grandparent' })],
      }),
      artStyle: 'vignette',
      captureQuestions: [{ id: 'q1', characterId: 'char_2', answer: 'Milo' }],
      childName: 'Kai',
      starCharacterId: null,
      refresh,
    });
    expect(prepared?.characters[0]?.name).toBe('Milo');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes style translations when the perception stamp targets a different style', async () => {
    const refreshed = identity({
      extractedForStyle: 'kawaii',
      characters: [character({ styleTranslation: 'chunky kawaii linework rendering' })],
    });
    const refresh = vi.fn(async () => refreshed);
    const prepared = await prepareIdentityForSheetPrewarm({
      identity: identity({ extractedForStyle: 'vignette' }),
      artStyle: 'kawaii',
      captureQuestions: [],
      childName: null,
      starCharacterId: null,
      refresh,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(prepared?.characters[0]?.styleTranslation).toBe('chunky kawaii linework rendering');
  });

  it('treats a missing extractedForStyle stamp as mismatched (pre-stamp identities)', async () => {
    const refresh = vi.fn(async (i: CharacterIdentity) => ({
      ...i,
      extractedForStyle: 'vignette',
    }));
    await prepareIdentityForSheetPrewarm({
      identity: identity({ extractedForStyle: undefined }),
      artStyle: 'vignette',
      captureQuestions: [],
      childName: null,
      starCharacterId: null,
      refresh,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('returns null (skip prep) when the refresh fails — stale-style sheets must never be pre-warmed', async () => {
    const prepared = await prepareIdentityForSheetPrewarm({
      identity: identity({ extractedForStyle: 'vignette' }),
      artStyle: 'kawaii',
      captureQuestions: [],
      childName: null,
      starCharacterId: null,
      refresh: vi.fn(async () => null),
    });
    expect(prepared).toBeNull();
  });

  it('merge feeds the refreshed call: names applied before refresh runs', async () => {
    const refresh = vi.fn(async (i: CharacterIdentity) => i);
    await prepareIdentityForSheetPrewarm({
      identity: identity({
        extractedForStyle: 'vignette',
        characters: [character({ characterId: 'char_2', role: 'grandparent' })],
      }),
      artStyle: 'kawaii',
      captureQuestions: [{ id: 'q1', characterId: 'char_2', answer: 'Milo' }],
      childName: null,
      starCharacterId: null,
      refresh,
    });
    const passed = refresh.mock.calls[0][0] as CharacterIdentity;
    expect(passed.characters[0].name).toBe('Milo');
  });
});
