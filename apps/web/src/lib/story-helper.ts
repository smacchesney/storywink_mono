/**
 * Story-helper (X11 D) pure helpers for the "Shape the story" wizard step and
 * the /api/story/propose route. Dependency-free per the repo's pure-helper
 * testing convention — every bound the strict json_schema can't express and
 * every step-machine transition lives here so it is unit-testable without
 * rendering the wizard.
 */

export type AvatarStoryStep = 'cast' | 'spark' | 'shape' | 'length';

export interface StoryProposal {
  storyline: string;
  alternates: string[];
}

/**
 * D1: the "Shape the story" step exists ONLY on the write-your-own path with
 * the client flag on. Deliberately does NOT depend on the typed premise — the
 * dot count is decided the moment the parent chooses "Write your own", so
 * typing never moves the goalposts mid-step.
 */
export function helperStepEnabled(writingOwn: boolean, flag: boolean): boolean {
  return writingOwn && flag;
}

/**
 * D1: the ordered wizard step list. Four steps with the helper, three without.
 * Dots, stepIndex, and next/prev routing all derive from this single list so
 * the count is stable and the transitions are pinned by one source of truth.
 */
export function avatarStorySteps(helperEnabled: boolean): AvatarStoryStep[] {
  return helperEnabled ? ['cast', 'spark', 'shape', 'length'] : ['cast', 'spark', 'length'];
}

/** Position of a step in the active list (−1 when the step is not in it). */
export function stepIndexOf(step: AvatarStoryStep, helperEnabled: boolean): number {
  return avatarStorySteps(helperEnabled).indexOf(step);
}

/** The step a forward "Next" tap lands on, or null at the last step. */
export function nextStep(step: AvatarStoryStep, helperEnabled: boolean): AvatarStoryStep | null {
  const steps = avatarStorySteps(helperEnabled);
  const i = steps.indexOf(step);
  return i >= 0 && i < steps.length - 1 ? steps[i + 1] : null;
}

/** The step the back button walks to, or null at the first step (leave wizard). */
export function prevStep(step: AvatarStoryStep, helperEnabled: boolean): AvatarStoryStep | null {
  const steps = avatarStorySteps(helperEnabled);
  const i = steps.indexOf(step);
  return i > 0 ? steps[i - 1] : null;
}

/**
 * D2: the proposal memo key. One call per unchanged signature — a re-entry via
 * back-nav with the same (premise, castIds, pageLength, language) reuses the
 * cached proposal instead of re-firing. Cast order is significant: pick order
 * chooses the star, so re-ordering the cast is a real input change.
 */
export function storyProposalSignature(input: {
  premise: string;
  castIds: string[];
  pageLength: number;
  language: string;
}): string {
  return JSON.stringify({
    premise: input.premise,
    castIds: input.castIds,
    pageLength: input.pageLength,
    language: input.language,
  });
}

/**
 * D5 (X11 hardening): the premise create() actually sends. The accepted/edited
 * storyline substitutes for the raw spark ONLY on the write-your-own path. A
 * parent who authors a spark, accepts a proposal, backs out to the spark step,
 * and picks a PRESET flips writingOwn to false — and must get the preset, never
 * the abandoned custom storyline. Gating on writingOwn is the belt that holds
 * even if the helper state wasn't cleared on the preset tap (the suspenders).
 * Empty/whitespace accepted text (skip and every fail-open) falls through to the
 * raw premise exactly as before.
 */
export function finalPremiseFor(
  writingOwn: boolean,
  acceptedStoryline: string,
  premise: string,
): string {
  const accepted = acceptedStoryline.trim();
  return writingOwn && accepted ? accepted : premise;
}

/** Storyline length cap. Enforced here, never in the strict schema. */
export const STORYLINE_MAX = 280;

/**
 * D3: enforce every bound the OpenAI strict json_schema cannot express (strict
 * mode rejects minItems/maxItems/minLength/maxLength). The model returns plain
 * strings and an unbounded string array; this clamps the storyline to 280
 * chars, keeps at most 2 non-empty alternates, and drops everything else.
 * Untrusted input: coerces types and never throws.
 */
export function sanitizeStoryProposal(raw: unknown): StoryProposal {
  const obj = (raw ?? {}) as { storyline?: unknown; alternates?: unknown };
  const clamp = (s: string) => s.trim().slice(0, STORYLINE_MAX);
  const storyline = typeof obj.storyline === 'string' ? clamp(obj.storyline) : '';
  const alternates = Array.isArray(obj.alternates)
    ? obj.alternates
        .filter((a): a is string => typeof a === 'string')
        .map(clamp)
        .filter((a) => a.length > 0)
        .slice(0, 2)
    : [];
  return { storyline, alternates };
}
