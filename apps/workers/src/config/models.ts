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
