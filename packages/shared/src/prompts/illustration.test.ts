import { describe, it, expect } from 'vitest';
import { createIllustrationPrompt, isMainCharacterRole } from './illustration.js';
import type { CharacterIdentity } from '../types.js';

// buildCharacterIdentitySection is not exported, so we exercise it through the
// public createIllustrationPrompt assembler (which appends the section).
const characterIdentity: CharacterIdentity = {
  sceneContext: 'A sunny backyard.',
  characters: [
    {
      characterId: 'child_1',
      role: 'main_child',
      name: 'Aria',
      physicalTraits: {
        apparentAge: '4 years old',
        hairColor: 'chestnut-brown',
        hairStyle: 'shoulder-length with a fringe',
        skinTone: 'warm-olive',
        bodyBuild: 'small and slight',
        distinguishingFeatures: ['a small freckle by her nose'],
      },
      typicalClothing: 'a red polka-dot dress',
      styleTranslation: 'rendered with soft pencil hatching and warm graphite tones',
      appearsOnPages: [3],
    },
    {
      characterId: 'adult_1',
      role: 'parent',
      name: 'Ben',
      physicalTraits: {
        apparentAge: '35 years old',
        hairColor: 'jet-black',
        hairStyle: 'short and tidy',
        skinTone: 'deep-brown',
        bodyBuild: 'tall and broad',
        distinguishingFeatures: ['round glasses'],
      },
      typicalClothing: 'a blue flannel shirt',
      styleTranslation: 'rendered with bold ink outlines',
      appearsOnPages: [5],
    },
  ],
};

describe('createIllustrationPrompt character identity section', () => {
  const prompt = createIllustrationPrompt({
    style: 'vignette',
    pageText: 'Aria spun in the sunshine.',
    bookTitle: "Aria's Big Day",
    isTitlePage: false,
    referenceImageCount: 1,
    characterIdentity,
    pageNumber: 3, // only character A (child_1) appears here
  });

  it("includes the appearing character's physical traits", () => {
    expect(prompt).toContain('chestnut-brown'); // hairColor
    expect(prompt).toContain('warm-olive'); // skinTone
  });

  it("includes the appearing character's style translation", () => {
    expect(prompt).toContain('rendered with soft pencil hatching and warm graphite tones');
  });

  it('names the appearing character', () => {
    expect(prompt).toContain('Aria');
  });

  it('excludes a character who does not appear on the current page', () => {
    // Ben (adult_1) only appears on page 5, so none of his traits should leak in.
    expect(prompt).not.toContain('jet-black');
    expect(prompt).not.toContain('deep-brown');
    expect(prompt).not.toContain('rendered with bold ink outlines');
  });

  it('demands canonical consistency across pages', () => {
    expect(prompt).toContain('CHARACTER IDENTITY');
    expect(prompt).toContain('canonical reference');
    expect(prompt).toMatch(/MUST match these descriptions on every page/i);
  });

  it('states the arbitration hierarchy: reference wins on identity, photo wins on the rest', () => {
    expect(prompt).toContain('these descriptions win');
    expect(prompt).toContain("Pose, clothing, and scene composition follow this page's photo");
  });
});

describe('main character always included regardless of appearsOnPages', () => {
  // Perception can miss the protagonist on ambiguous photos — exactly the
  // pages that need the canonical block most. main-role characters must never
  // be filtered out by appearsOnPages.
  const prompt = createIllustrationPrompt({
    style: 'vignette',
    pageText: 'Ben watered the plants.',
    bookTitle: "Aria's Big Day",
    isTitlePage: false,
    referenceImageCount: 1,
    characterIdentity,
    pageNumber: 5, // Aria's appearsOnPages is [3] — a perception miss for page 5
  });

  it('keeps the main_child on a page perception missed her on', () => {
    expect(prompt).toContain('Aria');
    expect(prompt).toContain('chestnut-brown');
  });

  it('still includes characters whose appearsOnPages match', () => {
    expect(prompt).toContain('Ben');
    expect(prompt).toContain('jet-black');
  });
});

describe('isMainCharacterRole', () => {
  it('matches main_child and other main-prefixed free-form roles', () => {
    expect(isMainCharacterRole('main_child')).toBe(true);
    expect(isMainCharacterRole('main')).toBe(true);
  });

  it('does not match non-main free-form roles', () => {
    expect(isMainCharacterRole('parent')).toBe(false);
    expect(isMainCharacterRole('grandparent')).toBe(false);
    expect(isMainCharacterRole('sibling')).toBe(false);
    expect(isMainCharacterRole('pet')).toBe(false);
  });
});

describe('role-labeled reference ordering (character sheets)', () => {
  it('keeps the legacy image-ordering line byte-identical when no sheets ride along', () => {
    const prompt = createIllustrationPrompt({
      style: 'vignette',
      pageText: 'Aria spun in the sunshine.',
      bookTitle: "Aria's Big Day",
      isTitlePage: false,
      referenceImageCount: 3,
    });
    expect(prompt).toContain(
      'using the 4 images provided. The first image shows the scene/subjects, the following 3 image(s) show the artistic style to apply.',
    );
    expect(prompt).not.toContain('CHARACTER SHEET');
  });

  it('names each image role by position when sheets are present', () => {
    const prompt = createIllustrationPrompt({
      style: 'vignette',
      pageText: 'Aria spun in the sunshine.',
      bookTitle: "Aria's Big Day",
      isTitlePage: false,
      referenceImageCount: 2,
      characterSheetCount: 2,
    });
    expect(prompt).toContain('using the 5 images provided, in this order:');
    expect(prompt).toContain("image 1 shows the scene/subjects (this page's photo)");
    expect(prompt).toContain('images 2-3 are CHARACTER SHEETS');
    expect(prompt).toContain('the final 2 images show the artistic style to apply');
  });

  it('labels the interior render on cover calls', () => {
    const prompt = createIllustrationPrompt({
      style: 'vignette',
      pageText: 'Aria spun in the sunshine.',
      bookTitle: "Aria's Big Day",
      isTitlePage: true,
      referenceImageCount: 2,
      characterSheetCount: 1,
      interiorRenderCount: 1,
    });
    expect(prompt).toContain('using the 5 images provided, in this order:');
    expect(prompt).toContain('image 2 is a CHARACTER SHEET');
    expect(prompt).toContain(
      "image 3 is the book's approved interior illustration of this same scene",
    );
  });
});

describe('bridge prompt variant (source=BRIDGE pages)', () => {
  const bridgeScene = {
    location: 'the sandy path to the beach',
    timeOfDay: 'morning',
    action: 'marching down the path, bucket swinging',
    charactersPresent: ['child_1'],
    outfitFrom: 'previous' as const,
    props: ['red bucket'],
  };

  const bridgePrompt = createIllustrationPrompt({
    style: 'vignette',
    pageText: 'Almost there, almost there!',
    bookTitle: "Aria's Big Day",
    isTitlePage: false,
    referenceImageCount: 3,
    characterIdentity,
    pageNumber: 4, // a bridge's own pageNumber never matches appearsOnPages
    bridgeScene,
  });

  it('is absent from ordinary photo pages', () => {
    const photoPrompt = createIllustrationPrompt({
      style: 'vignette',
      pageText: 'Aria spun in the sunshine.',
      bookTitle: "Aria's Big Day",
      isTitlePage: false,
      referenceImageCount: 3,
      characterIdentity,
      pageNumber: 3,
    });
    expect(photoPrompt).not.toContain('BRIDGE PAGE');
    expect(photoPrompt).not.toContain('do NOT copy its pose');
  });

  it('re-roles image 1: same people moments later, never a pose to copy', () => {
    expect(bridgePrompt).toContain('BRIDGE PAGE — THIS PAGE HAS NO PHOTO OF ITS OWN');
    expect(bridgePrompt).toContain('the same people moments later');
    expect(bridgePrompt).toContain('do NOT copy its pose');
    expect(bridgePrompt).toContain(
      'DEPICT THIS NEW MOMENT INSTEAD: marching down the path, bucket swinging',
    );
    expect(bridgePrompt).toContain('Location: the sandy path to the beach');
    expect(bridgePrompt).toContain('red bucket');
  });

  it('names the hierarchy it overrides, so the two absolutes can never fight', () => {
    // PEOPLE - SOURCE HIERARCHY item 2 orders "follow the photo exactly" for
    // pose/composition/people-present; the bridge section must explicitly
    // supersede it (not just the scene-interpretation text) and settle the
    // cast rule, or the model receives two conflicting non-negotiables.
    expect(bridgePrompt).toContain('supersedes');
    expect(bridgePrompt).toContain('item 2 of PEOPLE - SOURCE HIERARCHY');
    expect(bridgePrompt).toContain("People in this scene come ONLY from this scene's cast");
  });

  it('keeps the PEOPLE - SOURCE HIERARCHY block verbatim', () => {
    expect(bridgePrompt).toContain('PEOPLE - SOURCE HIERARCHY (non-negotiable)');
  });

  it('uses a bridge-aware identity arbitration trailer (pose follows the bridge, not the photo)', () => {
    expect(bridgePrompt).toContain(
      "Clothing follows this page's photo (image 1); pose and scene composition follow the BRIDGE PAGE instructions:",
    );
    expect(bridgePrompt).not.toContain(
      "Pose, clothing, and scene composition follow this page's photo:",
    );
  });

  it('keeps the photo-page identity trailer byte-identical on ordinary pages', () => {
    const photoPrompt = createIllustrationPrompt({
      style: 'vignette',
      pageText: 'Aria spun in the sunshine.',
      bookTitle: "Aria's Big Day",
      isTitlePage: false,
      referenceImageCount: 3,
      characterIdentity,
      pageNumber: 3,
    });
    expect(photoPrompt).toContain(
      "Pose, clothing, and scene composition follow this page's photo:",
    );
  });

  it('filters the identity section by scene.charactersPresent instead of appearsOnPages', () => {
    // child_1 is present per the scene (appearsOnPages could never match a
    // bridge pageNumber); adult_1 is not in the scene and must be excluded.
    expect(bridgePrompt).toContain('Aria (main_child)');
    expect(bridgePrompt).not.toContain('Ben (parent)');
  });

  it('falls back to the photo-page identity filter when no authored id resolves', () => {
    const stalePrompt = createIllustrationPrompt({
      style: 'vignette',
      pageText: 'Almost there!',
      bookTitle: "Aria's Big Day",
      isTitlePage: false,
      referenceImageCount: 3,
      characterIdentity,
      pageNumber: 4,
      bridgeScene: { ...bridgeScene, charactersPresent: ['gone_id'] },
    });
    // Roster re-extracted since the story ran: main character still rides
    // along via the main-role rule rather than losing the identity block.
    expect(stalePrompt).toContain('Aria (main_child)');
  });
});
