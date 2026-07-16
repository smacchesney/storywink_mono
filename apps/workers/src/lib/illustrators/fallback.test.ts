import { afterEach, describe, expect, it, vi } from 'vitest';
import { maybeGeminiFallback, shouldFallbackToGemini } from './fallback.js';
import type { IllustrationInput, IllustrationOutput, IllustrationProvider } from './types.js';

const FLAG = 'ILLUSTRATION_OPENAI_FALLBACK_GEMINI';

afterEach(() => {
  delete process.env[FLAG];
});

const sampleInput: IllustrationInput = {
  contentImage: { buffer: Buffer.from('photo'), mimeType: 'image/jpeg' },
  styleRefs: [{ buffer: Buffer.from('style'), mimeType: 'image/png' }],
  prompt: 'draw the scene',
};

function fakeGemini(output: IllustrationOutput | (() => never)): IllustrationProvider {
  return {
    name: 'gemini',
    modelId: 'gemini-3.1-flash-image-preview',
    generate: vi.fn(async () => {
      if (typeof output === 'function') return output();
      return output;
    }),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

describe('shouldFallbackToGemini', () => {
  it('is true only for OpenAI + a block + the exact flag "true"', () => {
    expect(shouldFallbackToGemini('openai', 'blocked', { [FLAG]: 'true' })).toBe(true);
  });

  it('is off by default (flag unset)', () => {
    expect(shouldFallbackToGemini('openai', 'blocked', {})).toBe(false);
  });

  it('requires the exact string "true"', () => {
    expect(shouldFallbackToGemini('openai', 'blocked', { [FLAG]: '1' })).toBe(false);
    expect(shouldFallbackToGemini('openai', 'blocked', { [FLAG]: 'TRUE' })).toBe(false);
  });

  it('never fires for the Gemini provider (no self-fallback)', () => {
    expect(shouldFallbackToGemini('gemini', 'blocked', { [FLAG]: 'true' })).toBe(false);
  });

  it('requires a block reason (no reason ⇒ a success, nothing to fall back from)', () => {
    expect(shouldFallbackToGemini('openai', undefined, { [FLAG]: 'true' })).toBe(false);
    expect(shouldFallbackToGemini('openai', '', { [FLAG]: 'true' })).toBe(false);
  });
});

describe('maybeGeminiFallback', () => {
  it('returns null and never builds Gemini when the flag is off', async () => {
    const makeGemini = vi.fn(() => fakeGemini({ imageBase64: 'img' }));
    const result = await maybeGeminiFallback({
      providerName: 'openai',
      blockedReason: '[OpenAI] content policy',
      input: sampleInput,
      env: {},
      makeGemini,
      logger: makeLogger(),
    });
    expect(result).toBeNull();
    expect(makeGemini).not.toHaveBeenCalled();
  });

  it('returns null for a non-OpenAI active provider', async () => {
    const makeGemini = vi.fn(() => fakeGemini({ imageBase64: 'img' }));
    const result = await maybeGeminiFallback({
      providerName: 'gemini',
      blockedReason: 'blocked',
      input: sampleInput,
      env: { [FLAG]: 'true' },
      makeGemini,
      logger: makeLogger(),
    });
    expect(result).toBeNull();
    expect(makeGemini).not.toHaveBeenCalled();
  });

  it('renders on Gemini with the SAME input and returns the image + provider on success', async () => {
    const gemini = fakeGemini({ imageBase64: 'gemini-bytes' });
    const logger = makeLogger();
    const result = await maybeGeminiFallback({
      providerName: 'openai',
      blockedReason: '[OpenAI] content policy',
      input: sampleInput,
      env: { [FLAG]: 'true' },
      makeGemini: () => gemini,
      logger,
    });
    expect(result).toEqual({ imageBase64: 'gemini-bytes', provider: gemini });
    // Same inputs, verbatim.
    expect(gemini.generate).toHaveBeenCalledWith(sampleInput);
    // Distinct searchable success event.
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'illustration_fallback_gemini', outcome: 'success' }),
      expect.any(String),
    );
  });

  it('returns null when Gemini also blocks', async () => {
    const gemini = fakeGemini({ blockedReason: 'gemini blocked too' });
    const logger = makeLogger();
    const result = await maybeGeminiFallback({
      providerName: 'openai',
      blockedReason: 'blocked',
      input: sampleInput,
      env: { [FLAG]: 'true' },
      makeGemini: () => gemini,
      logger,
    });
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'illustration_fallback_gemini', outcome: 'blocked' }),
      expect.any(String),
    );
  });

  it('returns null when the Gemini render throws', async () => {
    const gemini = fakeGemini(() => {
      throw new Error('network down');
    });
    const logger = makeLogger();
    const result = await maybeGeminiFallback({
      providerName: 'openai',
      blockedReason: 'blocked',
      input: sampleInput,
      env: { [FLAG]: 'true' },
      makeGemini: () => gemini,
      logger,
    });
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'illustration_fallback_gemini', outcome: 'error' }),
      expect.any(String),
    );
  });

  it('returns null when the Gemini provider cannot be built (missing key)', async () => {
    const logger = makeLogger();
    const result = await maybeGeminiFallback({
      providerName: 'openai',
      blockedReason: 'blocked',
      input: sampleInput,
      env: { [FLAG]: 'true' },
      makeGemini: () => {
        throw new Error('GOOGLE_API_KEY is required when ILLUSTRATION_PROVIDER=gemini');
      },
      logger,
    });
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'illustration_fallback_gemini', outcome: 'unavailable' }),
      expect.any(String),
    );
  });
});
