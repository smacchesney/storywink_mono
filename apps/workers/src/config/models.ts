/**
 * OpenAI model selection for worker pipelines.
 *
 * STORY_MODEL writes the creative story text — the product's core output —
 * so it runs on a flagship model. Perception and scoring tasks (character
 * extraction, illustration/story QC) stay on the mini tier where quality
 * is adequate and volume is higher.
 *
 * Env overrides allow rollback or experiments without a code deploy.
 */
export const STORY_MODEL = process.env.STORY_MODEL || 'gpt-5.6';
export const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'gpt-5-mini';

/**
 * Per-request OpenAI timeouts (X15). The SDK default is 10 minutes — longer
 * than most worker lockDurations, so a hung request could outlive its lock.
 * Each value must stay BELOW the owning worker's lockDuration (story 300s,
 * illustration/finalize 600s, analysis-tier workers 300s). SDK retries stay
 * at their default and run within one BullMQ attempt.
 */
function timeoutFromEnv(name: string, fallbackMs: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallbackMs;
}
export const STORY_OPENAI_TIMEOUT_MS = timeoutFromEnv('STORY_OPENAI_TIMEOUT_MS', 240_000);
export const IMAGE_OPENAI_TIMEOUT_MS = timeoutFromEnv('IMAGE_OPENAI_TIMEOUT_MS', 360_000);
export const ANALYSIS_OPENAI_TIMEOUT_MS = timeoutFromEnv('ANALYSIS_OPENAI_TIMEOUT_MS', 120_000);
// The two FAT vision calls (photo-analysis perception batch, extraction's
// fresh vision pass) carry up to ~16 detail-high images in one request —
// 120s would fail them systematically on max-photo books, not just at the
// tail. Still below their workers' 300s locks.
export const VISION_OPENAI_TIMEOUT_MS = timeoutFromEnv('VISION_OPENAI_TIMEOUT_MS', 240_000);

const STORY_REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;
type StoryReasoningEffort = (typeof STORY_REASONING_EFFORTS)[number];

/** X15 experiment knob: validated STORY_REASONING_EFFORT, or null for the
 * model-default request (also on a typo — never 400-loop the story job). */
export function storyReasoningEffort(): StoryReasoningEffort | null {
  const raw = process.env.STORY_REASONING_EFFORT;
  return (STORY_REASONING_EFFORTS as readonly string[]).includes(raw ?? '')
    ? (raw as StoryReasoningEffort)
    : null;
}
