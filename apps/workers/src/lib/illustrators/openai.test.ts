import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenAIProvider } from './openai.js';

// Constructing OpenAIProvider needs a key present but makes NO network call —
// the model id is resolved synchronously in the constructor.
const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_IMAGE_MODEL'] as const;
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) original[key] = process.env[key];
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_IMAGE_MODEL;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe('OpenAIProvider modelId resolution', () => {
  it('defaults to gpt-image-2 with no env override and no constructor override', () => {
    expect(new OpenAIProvider().modelId).toBe('gpt-image-2');
  });

  it('honors OPENAI_IMAGE_MODEL (env flip to a newer verified id)', () => {
    process.env.OPENAI_IMAGE_MODEL = 'gpt-image-2-2026-04-21';
    expect(new OpenAIProvider().modelId).toBe('gpt-image-2-2026-04-21');
  });

  it('lets a constructor modelId (escalation id) win over the env var', () => {
    process.env.OPENAI_IMAGE_MODEL = 'gpt-image-2';
    expect(new OpenAIProvider({ modelId: 'gpt-image-3' }).modelId).toBe('gpt-image-3');
  });

  it('uses the constructor modelId when no env var is set', () => {
    expect(new OpenAIProvider({ modelId: 'gpt-image-3' }).modelId).toBe('gpt-image-3');
  });

  it('throws without OPENAI_API_KEY', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIProvider()).toThrow(/OPENAI_API_KEY/);
  });
});
