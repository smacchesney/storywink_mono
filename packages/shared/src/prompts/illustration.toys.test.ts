import { describe, it, expect } from 'vitest';
import { createIllustrationPrompt, IllustrationPromptOptions } from './illustration.js';
import type { CharacterIdentity, CharacterDescription } from '../types.js';

// A cast with a real child (star), a beloved toy (companion_object), and a
// real pet — so the directive's "toy present" gate and the pet-untouched
// guarantee can both be exercised on one identity.
function char(
  characterId: string,
  role: string,
  name: string,
  appearsOnPages: number[],
): CharacterDescription {
  return {
    characterId,
    role,
    name,
    physicalTraits: {
      apparentAge: '3 years',
      hairColor: 'brown',
      hairStyle: 'curly',
      skinTone: 'warm light',
      bodyBuild: 'small',
      distinguishingFeatures: [],
    },
    typicalClothing: 'none',
    styleTranslation: 'soft pencil',
    appearsOnPages,
  };
}

const identityWithToy: CharacterIdentity = {
  sceneContext: '',
  characters: [
    char('avatar_1', 'main_child', 'Emma', []),
    char('avatar_2', 'companion_object', 'Trapjaw', []),
    char('avatar_3', 'pet', 'Biscuit', []),
  ],
};

const identityNoToy: CharacterIdentity = {
  sceneContext: '',
  characters: [char('avatar_1', 'main_child', 'Emma', []), char('avatar_3', 'pet', 'Biscuit', [])],
};

const baseOpts: IllustrationPromptOptions = {
  style: 'vignette',
  pageText: 'Emma and Trapjaw tiptoe to the gate.',
  bookTitle: 'The Rainy Rescue',
  isTitlePage: false,
  referenceImageCount: 2,
  characterIdentity: identityWithToy,
  pageNumber: 3,
  language: 'en',
  contentAnchor: 'sheet',
};

const sceneWithToy = {
  location: 'the rainy garden',
  timeOfDay: 'morning',
  action: 'tiptoeing to the gate',
  charactersPresent: ['avatar_1', 'avatar_2'],
  props: [],
};

describe('createIllustrationPrompt — toys come alive (X13 Track T)', () => {
  it('flag OFF emits no living-toy directive (byte-identical off-path)', () => {
    const off = createIllustrationPrompt({ ...baseOpts, bridgeScene: sceneWithToy });
    const explicitFalse = createIllustrationPrompt({
      ...baseOpts,
      bridgeScene: sceneWithToy,
      toysComeAlive: false,
    });
    expect(off).not.toMatch(/living/i);
    expect(off).not.toMatch(/figurine/i);
    // off ≡ absent — the flip must be deliberate.
    expect(off).toBe(explicitFalse);
  });

  it('flag ON adds the living-companion directive when a toy is in the page cast', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      bridgeScene: sceneWithToy,
      toysComeAlive: true,
    });
    // The toy is named, drawn alive + companion-scaled, never a static figurine.
    expect(prompt).toContain('Trapjaw');
    expect(prompt).toMatch(/living/i);
    expect(prompt).toMatch(/figurine/i);
    // Sheet still rules every material/color/shape — the directive is bounded.
    expect(prompt).toMatch(/character sheet/i);
  });

  it('flag ON stays silent when no toy is in the page cast (people + pets only)', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      characterIdentity: identityNoToy,
      bridgeScene: { ...sceneWithToy, charactersPresent: ['avatar_1', 'avatar_3'] },
      toysComeAlive: true,
    });
    expect(prompt).not.toMatch(/figurine/i);
  });

  it('flag ON stays silent when the toy is in the roster but off this page cast', () => {
    // The toy lives in the identity roster, but this page's scene cast is the
    // child + pet only — the gate must filter the toy out in lockstep with the
    // identity section, so the directive never names a toy off the page.
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      characterIdentity: identityWithToy,
      bridgeScene: { ...sceneWithToy, charactersPresent: ['avatar_1', 'avatar_3'] },
      toysComeAlive: true,
    });
    // pageText still says "Trapjaw", so scope the check to the directive itself.
    expect(prompt).not.toContain('LIVING TOY COMPANION');
    expect(prompt).not.toMatch(/figurine/i);
  });

  it('flag ON stays silent on an establishing shot (empty scene cast)', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      bridgeScene: { ...sceneWithToy, charactersPresent: [] },
      toysComeAlive: true,
    });
    expect(prompt).not.toMatch(/figurine/i);
  });

  it('flag ON respects neutral-name mode — the toy is a token, not its display name', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      bridgeScene: sceneWithToy,
      toysComeAlive: true,
      neutralizeCharacterNames: true,
    });
    // Star = Character 1, toy = Character 2 (roster order after the star).
    expect(prompt).toContain('Character 2');
    expect(prompt).not.toContain('Trapjaw');
    // Directive is still present, just tokenized.
    expect(prompt).toMatch(/figurine/i);
  });

  it('flag ON never touches the photo path (contentAnchor photo)', () => {
    const prompt = createIllustrationPrompt({
      ...baseOpts,
      contentAnchor: 'photo',
      bridgeScene: undefined,
      toysComeAlive: true,
    });
    expect(prompt).not.toMatch(/figurine/i);
  });
});
