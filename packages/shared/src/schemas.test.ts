import { describe, it, expect } from 'vitest';
import {
  createBookSchema,
  additionalCharacterSchema,
  bridgePageResponseSchema,
  avatarPageSceneSchema,
} from './schemas.js';

describe('createBookSchema', () => {
  it('parses a valid payload and applies defaults', () => {
    const result = createBookSchema.parse({ assetIds: ['a1', 'a2', 'a3'] });
    expect(result.assetIds).toEqual(['a1', 'a2', 'a3']);
    // Defaults fill in when omitted.
    expect(result.pageLength).toBe(10);
    expect(result.language).toBe('en');
  });

  it('round-trips explicit optional fields', () => {
    const input = {
      assetIds: ['a1'],
      pageLength: 12,
      language: 'ja' as const,
      artStyle: 'vignette',
      theme: 'A day at the beach',
    };
    const result = createBookSchema.parse(input);
    expect(result).toMatchObject(input);
  });

  it('rejects a payload with no assetIds', () => {
    expect(createBookSchema.safeParse({ assetIds: [] }).success).toBe(false);
    expect(createBookSchema.safeParse({}).success).toBe(false);
  });

  it('rejects more than 23 assetIds', () => {
    const tooMany = Array.from({ length: 24 }, (_, i) => `a${i}`);
    const result = createBookSchema.safeParse({ assetIds: tooMany });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 23 assetIds (boundary)', () => {
    const exactly = Array.from({ length: 23 }, (_, i) => `a${i}`);
    expect(createBookSchema.safeParse({ assetIds: exactly }).success).toBe(true);
  });

  it('rejects an out-of-range pageLength', () => {
    expect(createBookSchema.safeParse({ assetIds: ['a1'], pageLength: 5 }).success).toBe(false);
    expect(createBookSchema.safeParse({ assetIds: ['a1'], pageLength: 24 }).success).toBe(false);
  });
});

describe('additionalCharacterSchema', () => {
  it('parses a valid character', () => {
    const result = additionalCharacterSchema.parse({
      name: 'Grandma',
      relationship: 'grandmother',
    });
    expect(result).toEqual({ name: 'Grandma', relationship: 'grandmother' });
  });

  it('rejects an empty name or relationship', () => {
    expect(additionalCharacterSchema.safeParse({ name: '', relationship: 'friend' }).success).toBe(
      false,
    );
    expect(additionalCharacterSchema.safeParse({ name: 'Sam', relationship: '' }).success).toBe(
      false,
    );
  });
});

describe('bridgePageResponseSchema (story response additions)', () => {
  const valid = {
    afterPhotoPage: 3,
    text: 'Emma marched down the sandy path.',
    illustrationNotes: null,
    scene: {
      location: 'sandy path',
      timeOfDay: 'morning',
      action: 'marching to the beach',
      charactersPresent: ['char-1'],
      outfitFrom: 'previous',
      props: [],
    },
  };

  it('accepts a well-formed bridge entry', () => {
    expect(bridgePageResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects whitespace-only text', () => {
    expect(bridgePageResponseSchema.safeParse({ ...valid, text: '   ' }).success).toBe(false);
  });

  it('rejects an empty charactersPresent list', () => {
    expect(
      bridgePageResponseSchema.safeParse({
        ...valid,
        scene: { ...valid.scene, charactersPresent: [] },
      }).success,
    ).toBe(false);
  });

  it('rejects outfitFrom values outside previous|next', () => {
    expect(
      bridgePageResponseSchema.safeParse({
        ...valid,
        scene: { ...valid.scene, outfitFrom: 'both' },
      }).success,
    ).toBe(false);
  });

  it('rejects non-integer afterPhotoPage', () => {
    expect(bridgePageResponseSchema.safeParse({ ...valid, afterPhotoPage: 2.5 }).success).toBe(
      false,
    );
    expect(bridgePageResponseSchema.safeParse({ ...valid, afterPhotoPage: 0 }).success).toBe(false);
  });
});

describe('avatarPageSceneSchema (X13 Track L — mood + focus survive extraction)', () => {
  const valid = {
    location: 'the rainy garden',
    timeOfDay: 'morning',
    action: 'tiptoeing to the gate',
    charactersPresent: ['avatar_1'],
    props: ['red umbrella'],
  };

  it('keeps mood + focus when the model emits them (BLOCKER: zod must NOT strip them)', () => {
    const parsed = avatarPageSceneSchema.parse({
      ...valid,
      mood: 'hushed wonder',
      focus: 'Emma reaching for the gate latch',
    });
    expect(parsed.mood).toBe('hushed wonder');
    expect(parsed.focus).toBe('Emma reaching for the gate latch');
  });

  it('degrades safely: absent mood/focus default to null, never a parse failure', () => {
    expect(avatarPageSceneSchema.safeParse(valid).success).toBe(true);
    const parsed = avatarPageSceneSchema.parse(valid);
    expect(parsed.mood).toBe(null);
    expect(parsed.focus).toBe(null);
  });

  it('accepts an explicit null for mood/focus', () => {
    const parsed = avatarPageSceneSchema.parse({ ...valid, mood: null, focus: null });
    expect(parsed.mood).toBe(null);
    expect(parsed.focus).toBe(null);
  });
});
