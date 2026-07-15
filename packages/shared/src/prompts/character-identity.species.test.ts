import { describe, it, expect } from 'vitest';
import {
  speciesLineFor,
  kindFromRole,
  CHARACTER_IDENTITY_RESPONSE_SCHEMA,
  createAvatarIdentityPrompt,
  createCharacterExtractionPrompt,
} from './character-identity.js';
import type { SpeciesIdentity } from './character-identity.js';

// A CharacterDescription-shaped fixture (partial) — speciesLineFor only reads
// species, physicalTraits.distinguishingFeatures, and typicalClothing.
function identity(overrides: Partial<SpeciesIdentity> = {}): SpeciesIdentity {
  return {
    physicalTraits: { distinguishingFeatures: [] },
    typicalClothing: 'none',
    ...overrides,
  };
}

describe('speciesLineFor — prod cases (distilled, no species field)', () => {
  it('Grypho: a toy crocodile whose traits name its color and creature → "a green toy crocodile"', () => {
    // The croc toy that was drawn as a griffin because "Grypho" sounds like one.
    const grypho = identity({
      physicalTraits: {
        distinguishingFeatures: ['green scaly fabric', 'long crocodile snout', 'stubby legs'],
      },
      typicalClothing: 'none',
    });
    expect(speciesLineFor(grypho, 'toy')).toBe('a green toy crocodile');
  });

  it('Trapjaw: a toy whose traits are silent on color/creature → "a toy"', () => {
    // The dino toy fused with a real T-Rex; its extraction happened to be
    // silent on species, so the phrase gracefully falls back to just the kind.
    const trapjaw = identity({
      physicalTraits: { distinguishingFeatures: ['weathered plush', 'poseable arms'] },
      typicalClothing: 'none',
    });
    expect(speciesLineFor(trapjaw, 'toy')).toBe('a toy');
  });

  it('Kai: a person (a boy) → "a person"', () => {
    // Person identity is carried by the CHARACTER IDENTITY block + sheet, so
    // the species phrase stays deliberately generic.
    const kai = identity({
      physicalTraits: {
        distinguishingFeatures: ['freckles across the nose', 'gap-toothed smile'],
      },
      typicalClothing: 'red hoodie',
    });
    expect(speciesLineFor(kai, 'person')).toBe('a person');
  });
});

describe('speciesLineFor — silent-traits fallback', () => {
  it('a toy with nothing distinctive → "a toy"', () => {
    expect(speciesLineFor(identity(), 'toy')).toBe('a toy');
  });

  it('a pet with nothing distinctive → "a pet"', () => {
    expect(speciesLineFor(identity(), 'pet')).toBe('a pet');
  });

  it('a person with nothing distinctive → "a person"', () => {
    expect(speciesLineFor(identity(), 'person')).toBe('a person');
  });

  it('a null/undefined identity falls back to just the kind', () => {
    expect(speciesLineFor(null, 'toy')).toBe('a toy');
    expect(speciesLineFor(undefined, 'pet')).toBe('a pet');
  });
});

describe('speciesLineFor — pet distillation', () => {
  it('names the animal (and drops the "pet" qualifier) when the creature is known', () => {
    const dog = identity({
      physicalTraits: { distinguishingFeatures: ['golden fur', 'floppy dog ears'] },
    });
    expect(speciesLineFor(dog, 'pet')).toBe('a golden dog');
  });

  it('uses "an" before a vowel-initial distilled phrase', () => {
    const owl = identity({
      physicalTraits: { distinguishingFeatures: ['snowy owl markings'] },
    });
    expect(speciesLineFor(owl, 'pet')).toBe('an owl');
    // Colored phrases keep "a" when the first word starts with a consonant.
    const croc = identity({
      physicalTraits: { distinguishingFeatures: ['green scaly fabric', 'long crocodile snout'] },
    });
    expect(speciesLineFor(croc, 'toy')).toBe('a green toy crocodile');
  });

  it("does not paint the pet with its collar's color — body color comes from features only", () => {
    const collared = identity({
      physicalTraits: { distinguishingFeatures: ['floppy dog ears'] },
      typicalClothing: 'red collar',
    });
    expect(speciesLineFor(collared, 'pet')).toBe('a dog');
  });

  it('the creature noun may still come from the clothing text', () => {
    const harnessed = identity({
      physicalTraits: { distinguishingFeatures: ['golden fur'] },
      typicalClothing: 'small dog harness',
    });
    expect(speciesLineFor(harnessed, 'pet')).toBe('a golden dog');
  });
});

describe('speciesLineFor — explicit species field short-circuits distillation', () => {
  it('uses the extraction-provided species verbatim with an article', () => {
    const newAvatar = identity({ species: 'young boy' });
    expect(speciesLineFor(newAvatar, 'person')).toBe('a young boy');
  });

  it('does not double an article the species already carries', () => {
    expect(speciesLineFor(identity({ species: 'a toy dinosaur' }), 'toy')).toBe('a toy dinosaur');
    expect(speciesLineFor(identity({ species: 'an owl' }), 'pet')).toBe('an owl');
  });

  it('wins over distilled traits', () => {
    const conflicting = identity({
      species: 'toy crocodile',
      physicalTraits: { distinguishingFeatures: ['green fabric', 'dog ears'] },
    });
    expect(speciesLineFor(conflicting, 'toy')).toBe('a toy crocodile');
  });

  it('treats a blank species as absent', () => {
    expect(speciesLineFor(identity({ species: '   ' }), 'toy')).toBe('a toy');
  });
});

describe('identity-extraction schema — additive species field', () => {
  const props = CHARACTER_IDENTITY_RESPONSE_SCHEMA.properties.characters.items.properties as Record<
    string,
    { type: unknown }
  >;
  const required: readonly string[] =
    CHARACTER_IDENTITY_RESPONSE_SCHEMA.properties.characters.items.required;

  it('exposes species as a nullable property', () => {
    expect(props.species).toEqual({ type: ['string', 'null'] });
  });

  it('keeps species in required so OpenAI strict mode stays valid', () => {
    // strict mode demands every property appear in required; nullable lets the
    // model omit it in spirit by returning null.
    expect(required).toContain('species');
    expect(required).toContain('name');
  });

  it('both extraction prompts instruct the model to fill species', () => {
    const avatar = createAvatarIdentityPrompt({
      kind: 'TOY',
      displayName: 'Grypho',
      artStyle: 'vignette',
      photoCount: 3,
    }).text;
    expect(avatar).toMatch(/Species \/ Kind/);

    const multi = createCharacterExtractionPrompt({
      childName: 'Kai',
      additionalCharacters: null,
      artStyle: 'vignette',
      storyPages: [{ pageNumber: 1, imageUrl: 'x' }],
    }).text;
    expect(multi).toMatch(/Species \/ Kind/);
  });
});

describe('kindFromRole', () => {
  it('maps the extraction roles onto the three kind buckets', () => {
    expect(kindFromRole('pet')).toBe('pet');
    expect(kindFromRole('companion_object')).toBe('toy');
    expect(kindFromRole('main_child')).toBe('person');
    expect(kindFromRole('adult')).toBe('person');
    expect(kindFromRole('grandparent')).toBe('person');
  });

  it('defaults unknown or missing roles to person', () => {
    expect(kindFromRole(undefined)).toBe('person');
    expect(kindFromRole(null)).toBe('person');
    expect(kindFromRole('')).toBe('person');
    expect(kindFromRole('wizard')).toBe('person');
  });
});
