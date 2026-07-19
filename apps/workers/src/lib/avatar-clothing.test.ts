import { describe, it, expect } from 'vitest';
import { applyClothingToIdentity, buildStyleTranslationRewritePrompt } from './avatar-clothing.js';

const character = {
  characterId: 'char_1',
  role: 'main_child',
  name: 'Kai',
  typicalClothing: 'blue tee and shorts',
  styleTranslation: 'Paint the blue tee with gouache.',
};

describe('applyClothingToIdentity (X15 clothing reconcile)', () => {
  it('patches a NESTED identity (identity.character) preserving the shape', () => {
    const identity = { character: { ...character }, extractedForStyle: 'vignette' };
    const out = applyClothingToIdentity(identity, 'orange tee', 'Paint the orange tee with gouache.');
    expect(out.character.typicalClothing).toBe('orange tee');
    expect(out.character.styleTranslation).toBe('Paint the orange tee with gouache.');
    expect(out.extractedForStyle).toBe('vignette');
    expect('typicalClothing' in out).toBe(false);
    // input untouched
    expect(identity.character.typicalClothing).toBe('blue tee and shorts');
  });

  it('patches a FLAT identity preserving the shape', () => {
    const identity = { ...character };
    const out = applyClothingToIdentity(identity, 'orange tee', 'Paint the orange tee.');
    expect(out.typicalClothing).toBe('orange tee');
    expect(out.styleTranslation).toBe('Paint the orange tee.');
    expect('character' in out).toBe(false);
  });

  it('keeps the existing styleTranslation when no rewrite is supplied', () => {
    const identity = { character: { ...character } };
    const out = applyClothingToIdentity(identity, 'orange tee', null);
    expect(out.character.typicalClothing).toBe('orange tee');
    expect(out.character.styleTranslation).toBe('Paint the blue tee with gouache.');
  });
});

describe('buildStyleTranslationRewritePrompt', () => {
  it('carries both the original prose and the observed clothing verbatim', () => {
    const p = buildStyleTranslationRewritePrompt('Paint the blue tee.', 'orange raglan tee');
    expect(p).toContain('Paint the blue tee.');
    expect(p).toContain('orange raglan tee');
  });
});
