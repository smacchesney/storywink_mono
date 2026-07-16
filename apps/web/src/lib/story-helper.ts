/**
 * Story-helper (X11 D) pure helpers for the "Shape the story" wizard step and
 * the /api/story/propose route. Dependency-free per the repo's pure-helper
 * testing convention — every bound the strict json_schema can't express, every
 * step-machine transition, and the propose prompt itself live here so they are
 * unit-testable (and pinnable) without rendering the wizard or hitting OpenAI.
 */

import type { CastKind } from './avatar-story';

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

/**
 * "More ideas" is pool-only: it cycles the alternates this shape entry already
 * prefetched (storyline + up to two alternates) and wraps at the end — never a
 * fresh API call from the button (a tap is always instant). Returns the next
 * index, or 0 for an empty pool.
 */
export function nextIdeaIndex(poolLength: number, index: number): number {
  if (poolLength <= 0) return 0;
  return (index + 1) % poolLength;
}

/** Storyline length cap. Enforced here, never in the strict schema. */
export const STORYLINE_MAX = 280;

/**
 * D3 latency (X13 V): reasoning effort for the propose call. The task is tiny —
 * a <=280-char storyline plus two alternates — so the model needs no deep chain
 * of thought. `minimal` is the lowest tier gpt-5-mini supports and cuts the
 * reasoning tokens that pushed prod p50 to ~21s (past the client's 6s abort).
 * Typed as a literal so the route binds it to the OpenAI SDK's ReasoningEffort
 * at the call site — a bad value fails type-check there, not at runtime.
 */
export const STORY_PROPOSAL_REASONING_EFFORT = 'minimal' as const;

/**
 * D3 latency (X13 V): output cap for the propose call. The response is ~900
 * chars of JSON (storyline + two alternates); 2000 tokens leaves generous
 * headroom while bounding a runaway generation.
 */
export const STORY_PROPOSAL_MAX_OUTPUT_TOKENS = 2000;

/**
 * Strict json_schema for the propose call: NO min/max keywords (strict mode
 * rejects them). Plain strings and an unbounded string array, every property
 * required, additionalProperties false. Every bound lives in
 * sanitizeStoryProposal — this only pins the shape. Kept here with the other
 * pure propose helpers so route.ts stays handlers-only and the schema is
 * pinnable without hitting OpenAI.
 */
export const STORY_PROPOSAL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    storyline: { type: 'string' },
    alternates: { type: 'array', items: { type: 'string' } },
  },
  required: ['storyline', 'alternates'],
  additionalProperties: false,
} as const;

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

/**
 * The shape of one cast member the propose prompt names. A `type` alias (not an
 * interface) so an array of these stays assignable to Prisma's Json input type
 * when the props builder spreads the cast onto the telemetry row.
 */
export type StoryProposalCastMember = {
  name: string;
  kind: CastKind;
  isStar: boolean;
};

/** Everything the propose prompt needs — mirrors the route's request schema. */
export interface StoryProposalInput {
  cast: StoryProposalCastMember[];
  premise: string;
  pageLength: number;
  language: 'en' | 'ja';
}

/**
 * The propose call's system prompt. Lives here (not in the route) so route.ts
 * keeps exporting only handlers AND the prompt is pinnable. The ramble handling
 * is load-bearing: the spark field now welcomes a spoken, half-finished idea,
 * so the model is told to find the story inside it and keep the parent's own
 * words where they sparkle, rather than expecting a tidy premise.
 */
export const STORY_PROPOSAL_SYSTEM_PROMPT =
  "You are a warm picture-book story consultant for a children's book studio. A parent gives you their own little story idea and the cast of characters. Their idea may be a child's spoken ramble: half-finished, out of order, more feeling than plot. Find the story inside it (the characters' goal and the fun bits) and keep the parent's own words wherever they sparkle. You grow it into ONE inviting storyline the parent will instantly recognize as their idea, never replacing it, only shaping it into a clear beginning, middle, and end a small child would love. You stay grounded in what the parent said and keep every character they named.";

/**
 * Build the propose user prompt. Requiring the storyline to NAME the star's
 * goal is deliberate: it seeds the agency arc Track S leans on (a doer with one
 * clear goal), so the wizard proposal and the final story pull the same way.
 */
export function buildStoryProposalPrompt(input: StoryProposalInput): string {
  const castLines = input.cast
    .map((c) => `- ${c.name} (${c.kind.toLowerCase()}${c.isStar ? ', the star' : ''})`)
    .join('\n');
  const langNote =
    input.language === 'ja'
      ? 'Write the storyline and alternates in natural, warm Japanese for a toddler.'
      : 'Write the storyline and alternates in warm, simple English for a toddler.';
  return `The parent's story idea, in their words: "${input.premise}"

The cast for this ${input.pageLength}-page picture book:
${castLines}

Shape their idea into a storyline:
- "storyline": ONE short paragraph (at most ${STORYLINE_MAX} characters) that keeps the parent's idea and every named character, and NAMES what the star is trying to do (their goal), with a clear beginning, a middle, and a gentle ending a small child would enjoy. Recognizably THEIR story, grown, not a new one.
- "alternates": exactly TWO other short takes on the SAME idea and cast (each at most ${STORYLINE_MAX} characters), each a genuinely different direction.

${langNote}`;
}

/**
 * The tuning row the route writes after a successful propose call. A `type`
 * alias (not an interface) so it stays assignable to Prisma's Json input type,
 * which needs a closed, index-signature-compatible shape.
 */
export type StoryProposalEventProps = {
  cast: StoryProposalCastMember[];
  premise: string;
  pageLength: number;
  language: 'en' | 'ja';
  storyline: string;
  alternates: string[];
  /**
   * X13 V: wall-clock latency of the OpenAI call in milliseconds. Additive to
   * the JSON props (no schema change) so the latency runbook can read propose
   * durations straight off the AppEvent rows instead of Railway logs.
   */
  durationMs: number;
};

/**
 * Build the `story_proposal` AppEvent props (request + sanitized result +
 * server-timed durationMs). Pure so the durationMs field is pinnable without a
 * route harness — the route only supplies the measured elapsed time.
 */
export function buildStoryProposalEventProps(args: {
  input: StoryProposalInput;
  proposal: StoryProposal;
  durationMs: number;
}): StoryProposalEventProps {
  const { input, proposal, durationMs } = args;
  return {
    cast: input.cast,
    premise: input.premise,
    pageLength: input.pageLength,
    language: input.language,
    storyline: proposal.storyline,
    alternates: proposal.alternates,
    durationMs,
  };
}
