import { describe, it, expect } from 'vitest';
import { createAvatarBookSchema } from './avatar-story-schema';
import { PREMISE_MAX_CHARS } from './avatar-story';

const valid = {
  bookType: 'AVATAR_STORY' as const,
  avatarIds: ['cx6dseedemma000000000001'],
  premise: 'A rainy-day rescue',
  pageLength: 12,
  artStyle: 'vignette',
  language: 'en' as const,
};

describe('createAvatarBookSchema', () => {
  it('accepts a valid request and defaults language', () => {
    const { language: _language, ...rest } = valid;
    const parsed = createAvatarBookSchema.parse(rest);
    expect(parsed.language).toBe('en');
    expect(parsed.pageLength).toBe(12);
  });

  it('locks pageLength to 8/12/16', () => {
    for (const ok of [8, 12, 16]) {
      expect(createAvatarBookSchema.safeParse({ ...valid, pageLength: ok }).success).toBe(true);
    }
    for (const bad of [7, 10, 23, 0, -8, 12.5]) {
      expect(createAvatarBookSchema.safeParse({ ...valid, pageLength: bad }).success).toBe(false);
    }
  });

  it('bounds the cast and the premise', () => {
    expect(createAvatarBookSchema.safeParse({ ...valid, avatarIds: [] }).success).toBe(false);
    expect(
      createAvatarBookSchema.safeParse({
        ...valid,
        avatarIds: Array(7).fill('cx6dseedemma000000000001'),
      }).success,
    ).toBe(false);
    expect(createAvatarBookSchema.safeParse({ ...valid, premise: '' }).success).toBe(false);
    // A ramble is welcome up to the 1500-char wall; one over is rejected.
    expect(PREMISE_MAX_CHARS).toBe(1500);
    expect(
      createAvatarBookSchema.safeParse({ ...valid, premise: 'x'.repeat(PREMISE_MAX_CHARS) })
        .success,
    ).toBe(true);
    expect(
      createAvatarBookSchema.safeParse({ ...valid, premise: 'x'.repeat(PREMISE_MAX_CHARS + 1) })
        .success,
    ).toBe(false);
  });

  it('trims the premise and rejects whitespace-only sparks', () => {
    expect(createAvatarBookSchema.parse({ ...valid, premise: '  hi  ' }).premise).toBe('hi');
    expect(createAvatarBookSchema.safeParse({ ...valid, premise: '   ' }).success).toBe(false);
  });

  it('rejects non-cuid avatar ids and foreign bookTypes', () => {
    expect(createAvatarBookSchema.safeParse({ ...valid, avatarIds: ['nope'] }).success).toBe(false);
    expect(createAvatarBookSchema.safeParse({ ...valid, bookType: 'PHOTO_STORY' }).success).toBe(
      false,
    );
  });
});
