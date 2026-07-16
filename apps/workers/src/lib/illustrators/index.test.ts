import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEscalationIllustrator, getGeminiFallbackIllustrator } from './index.js';

// Provider construction needs keys present but makes no network call. Every
// test uses a DISTINCT model id so the per-model escalation memo never leaks
// state between assertions.
const ENV_KEYS = ['OPENAI_API_KEY', 'GOOGLE_API_KEY'] as const;
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) original[key] = process.env[key];
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.GOOGLE_API_KEY = 'test-key';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe('getEscalationIllustrator', () => {
  it('passes a gpt- escalation id through to the OpenAI provider', () => {
    const provider = getEscalationIllustrator('gpt-image-3-escalation-test');
    expect(provider.name).toBe('openai');
    // The resolved id reaches the provider — not the constructor default.
    expect(provider.modelId).toBe('gpt-image-3-escalation-test');
  });

  it('routes a gemini escalation id to the Gemini provider unchanged', () => {
    const provider = getEscalationIllustrator('gemini-3-pro-image-escalation-test');
    expect(provider.name).toBe('gemini');
    expect(provider.modelId).toBe('gemini-3-pro-image-escalation-test');
  });
});

describe('getGeminiFallbackIllustrator', () => {
  it('returns a memoized Gemini provider for the dark content-policy fallback', () => {
    const first = getGeminiFallbackIllustrator();
    const second = getGeminiFallbackIllustrator();
    expect(first.name).toBe('gemini');
    expect(second).toBe(first);
  });
});
