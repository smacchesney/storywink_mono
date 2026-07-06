/**
 * QC escalation ladder (ILLUSTRATION_ESCALATION_ENABLED) — pure helpers.
 *
 * When a page fails QC going into the FINAL re-render round, book-finalize
 * marks that round's re-render job with an escalation model override and the
 * illustration worker renders it on a stronger model (default
 * gemini-3-pro-image; gpt-image-2 switches provider at quality medium).
 * One escalated render per page per book run — the final round IS the
 * escalated round, no extra QC pass is added.
 *
 * Everything here is deterministic and dependency-free so the round gating
 * and model→provider routing are unit-testable.
 */

/** Workers env flag — default OFF. */
export function illustrationEscalationEnabled(): boolean {
  return process.env.ILLUSTRATION_ESCALATION_ENABLED === 'true';
}

export const DEFAULT_ESCALATION_MODEL = 'gemini-3-pro-image';

/** Model id escalated re-renders run on (ILLUSTRATION_ESCALATION_MODEL). */
export function escalationModel(): string {
  return process.env.ILLUSTRATION_ESCALATION_MODEL || DEFAULT_ESCALATION_MODEL;
}

/**
 * True when the re-render round being enqueued is the book's last chance
 * (nextRound === maxRounds — after it, finalize accepts whatever exists).
 * Only that final round escalates; earlier rounds stay on the default model.
 */
export function shouldEscalate(nextRound: number, maxRounds: number, enabled: boolean): boolean {
  return enabled && nextRound >= maxRounds;
}

/**
 * Which provider serves an escalation model id. gpt-* ids run on OpenAI
 * (gpt-image-2 at quality medium); everything else is treated as a Gemini
 * model id and passed through to the Gemini provider.
 */
export function providerNameForModel(model: string): 'gemini' | 'openai' {
  return model.startsWith('gpt-') ? 'openai' : 'gemini';
}

/**
 * Escalation marker carried in illustration job data. Kept as a local
 * intersection type (not on IllustrationGenerationJobV2) — only the QC
 * requeue path in book-finalize ever sets it.
 */
export interface EscalationJobFields {
  escalation?: {
    /** Exact model id the escalated render must use. */
    model: string;
  };
}
