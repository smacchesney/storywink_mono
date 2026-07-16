/**
 * Dark per-page content-policy fallback (ILLUSTRATION_OPENAI_FALLBACK_GEMINI).
 *
 * OpenAI's image model can refuse child depictions. Today that refusal burns
 * the content-policy retries, marks the page FLAGGED and ships it without art
 * (book → PARTIAL). When the flag is ON and the active provider is OpenAI, a
 * content-policy block triggers ONE Gemini re-attempt on the SAME inputs
 * before the page falls into the retry/FLAGGED path.
 *
 * Default OFF: `shouldFallbackToGemini` returns false and `maybeGeminiFallback`
 * returns null with zero side effects, so behavior is byte-identical to before.
 *
 * Scope: content-policy blocks only (surfaced as `blockedReason`). Transient
 * errors — timeouts, 5xx, rate limits — throw from the provider and never reach
 * here, so they keep the existing retry semantics.
 */

import type { IllustrationInput, IllustrationProvider } from './types.js';

type FallbackLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
};

/**
 * Pure decision: should an OpenAI content-policy block hand off to Gemini?
 * True only when the active provider is OpenAI, the render reported a block
 * (`blockedReason` present), and the flag is exactly "true".
 */
export function shouldFallbackToGemini(
  providerName: string,
  blockedReason: string | undefined | null,
  env: NodeJS.ProcessEnv,
): boolean {
  return (
    providerName === 'openai' &&
    !!blockedReason &&
    env.ILLUSTRATION_OPENAI_FALLBACK_GEMINI === 'true'
  );
}

export interface GeminiFallbackParams {
  /** Active illustrator name (`illustrator.name`). */
  providerName: string;
  /** The block reason returned by the OpenAI render (undefined ⇒ no block). */
  blockedReason: string | undefined | null;
  /** The exact IllustrationInput the OpenAI render used — reused verbatim. */
  input: IllustrationInput;
  env: NodeJS.ProcessEnv;
  /** Constructs the Gemini fallback provider; may throw (e.g. missing key). */
  makeGemini: () => IllustrationProvider;
  logger: FallbackLogger;
  /** Structured log context (jobId, pageId, pageNumber) for traceability. */
  logContext?: Record<string, unknown>;
}

/**
 * Attempt the one Gemini fallback render if the decision permits it.
 *
 * Returns the successful provider + image on success; null in every other case
 * (flag off, non-OpenAI, no block, Gemini unavailable, Gemini also blocked,
 * Gemini threw) so the caller keeps its existing retry/FLAGGED behavior. Every
 * outcome is logged under the searchable event `illustration_fallback_gemini`.
 */
export async function maybeGeminiFallback(
  params: GeminiFallbackParams,
): Promise<{ imageBase64: string; provider: IllustrationProvider } | null> {
  const { providerName, blockedReason, input, env, makeGemini, logger, logContext } = params;

  if (!shouldFallbackToGemini(providerName, blockedReason, env)) return null;

  let gemini: IllustrationProvider;
  try {
    gemini = makeGemini();
  } catch (err) {
    logger.warn(
      {
        ...logContext,
        event: 'illustration_fallback_gemini',
        outcome: 'unavailable',
        error: (err as Error).message,
      },
      'Gemini fallback provider unavailable — keeping OpenAI content-policy block',
    );
    return null;
  }

  logger.info(
    {
      ...logContext,
      event: 'illustration_fallback_gemini',
      outcome: 'attempt',
      model: gemini.modelId,
    },
    'OpenAI content-policy block — attempting one Gemini fallback render',
  );

  try {
    const result = await gemini.generate(input);
    if (result.imageBase64) {
      logger.info(
        {
          ...logContext,
          event: 'illustration_fallback_gemini',
          outcome: 'success',
          model: gemini.modelId,
        },
        'Gemini fallback render succeeded',
      );
      return { imageBase64: result.imageBase64, provider: gemini };
    }
    logger.warn(
      {
        ...logContext,
        event: 'illustration_fallback_gemini',
        outcome: 'blocked',
        model: gemini.modelId,
        reason: result.blockedReason,
      },
      'Gemini fallback render also blocked',
    );
    return null;
  } catch (err) {
    logger.warn(
      {
        ...logContext,
        event: 'illustration_fallback_gemini',
        outcome: 'error',
        model: gemini.modelId,
        error: (err as Error).message,
      },
      'Gemini fallback render threw',
    );
    return null;
  }
}
