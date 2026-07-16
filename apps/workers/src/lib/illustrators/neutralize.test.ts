import { describe, expect, it } from 'vitest';
import { shouldNeutralizeNames } from './neutralize.js';

describe('shouldNeutralizeNames', () => {
  it('is true for the OpenAI provider (name-semantics beats reference sheets)', () => {
    expect(shouldNeutralizeNames('openai')).toBe(true);
  });

  it('is false for the Gemini provider (Track A validated Gemini WITH names)', () => {
    expect(shouldNeutralizeNames('gemini')).toBe(false);
  });
});
