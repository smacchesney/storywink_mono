import { describe, it, expect } from 'vitest';
import { createAvatarIdentityPrompt } from './character-identity.js';

const base = {
  kind: 'TOY' as const,
  displayName: 'Beast',
  artStyle: 'vignette',
  photoCount: 3,
};

describe('createAvatarIdentityPrompt subject anchor', () => {
  it('renders no anchor when no subjectDescription is given', () => {
    const { text } = createAvatarIdentityPrompt(base);
    expect(text).not.toMatch(/the subject is:/i);
    expect(text).not.toMatch(/ignore any other/i);
    // The base contract is unchanged.
    expect(text).toContain('Analyze all 3 photos provided');
  });

  it('is byte-identical whether the field is absent or explicitly undefined (additive)', () => {
    const absent = createAvatarIdentityPrompt(base).text;
    const undefinedField = createAvatarIdentityPrompt({
      ...base,
      subjectDescription: undefined,
    }).text;
    expect(undefinedField).toBe(absent);
  });

  it('binds extraction to the described figure when a subjectDescription is given', () => {
    const { text } = createAvatarIdentityPrompt({
      ...base,
      subjectDescription: 'the red-furred beast toy on the left',
    });
    expect(text).toContain('the red-furred beast toy on the left');
    expect(text).toMatch(/the subject is:/i);
    expect(text).toMatch(/ignore any other/i);
    // The anchor is additive: the base contract still follows it.
    expect(text).toContain('Analyze all 3 photos provided');
  });

  it('ignores an empty-string subjectDescription (treated as absent)', () => {
    const { text } = createAvatarIdentityPrompt({ ...base, subjectDescription: '   ' });
    expect(text).toBe(createAvatarIdentityPrompt(base).text);
  });
});
