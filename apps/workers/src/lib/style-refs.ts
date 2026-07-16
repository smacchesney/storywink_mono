/**
 * X12-D Stage 1 experiment: style-reference diet (ILLUSTRATION_STYLE_REFS_MAX).
 *
 * The worker normally sends the style's exemplar images (trimmed to 2 when
 * character sheets ride along). For the OpenAI accuracy experiments the env
 * var caps that count further — `0` sends NO style-ref images at all (the
 * style bible TEXT remains the style truth) so the reference budget goes
 * entirely to identity sheets. Unset/invalid = null = current behavior.
 */

import type { IllustrationProviderName } from './illustrators/types.js';

/** Parse ILLUSTRATION_STYLE_REFS_MAX. null = unset/invalid → current behavior. */
export function styleRefsMax(env: NodeJS.ProcessEnv): number | null {
  const raw = env.ILLUSTRATION_STYLE_REFS_MAX;
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/** Apply the cap. A null cap returns the list unchanged. */
export function capStyleRefs<T>(urls: T[], cap: number | null): T[] {
  return cap === null ? urls : urls.slice(0, cap);
}

/**
 * Rollback one-variable guarantee (X12-D flip-prep): the style-ref diet is
 * validated for OpenAI only. Rolling back to ILLUSTRATION_PROVIDER=gemini must
 * stay a single variable change — with ILLUSTRATION_STYLE_REFS_MAX still set,
 * an ungated cap would run Gemini in an unvalidated low/zero-style-ref config.
 * The cap therefore applies only when the provider executing the render is
 * OpenAI; every other provider gets null (= current behavior).
 */
export function styleRefsCapForProvider(
  providerName: IllustrationProviderName,
  env: NodeJS.ProcessEnv,
): number | null {
  return providerName === 'openai' ? styleRefsMax(env) : null;
}
