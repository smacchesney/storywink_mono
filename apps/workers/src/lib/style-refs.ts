/**
 * X12-D Stage 1 experiment: style-reference diet (ILLUSTRATION_STYLE_REFS_MAX).
 *
 * The worker normally sends the style's exemplar images (trimmed to 2 when
 * character sheets ride along). For the OpenAI accuracy experiments the env
 * var caps that count further — `0` sends NO style-ref images at all (the
 * style bible TEXT remains the style truth) so the reference budget goes
 * entirely to identity sheets. Unset/invalid = null = current behavior.
 */

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
