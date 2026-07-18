/**
 * STORY QUALITY V2 (env flag STORY_QUALITY_V2) — the workers-side gate for
 * the new hard enforcement layer: word/sentence caps, cast-name garbles,
 * per-page beat delivery, avatar text↔scene agreement, and agency.
 *
 * The deterministic checks below ALWAYS compute (they feed telemetry either
 * way); the flag only decides whether their findings block a draft and
 * trigger regeneration. Default OFF; rollback is a single variable change.
 *
 * Pure and dependency-free per the repo's extract-pure-helper convention.
 */
import {
  wordBudgetProblems,
  findNameGarbles,
  rollCallProblems,
  WordBudgetProblem,
  NameGarble,
  RollCallProblem,
} from '@storywink/shared/prompts/story-check';

export function storyQualityV2Enabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = (env.STORY_QUALITY_V2 || '').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * STORY_ILLUS_MOOD_ENABLED: whether the photo path's per-page mood cue
 * (Page.illustrationMood) is threaded into the interior illustration prompt.
 * Persistence is unconditional; this flag only gates rendering.
 */
export function storyIllusMoodEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = (env.STORY_ILLUS_MOOD_ENABLED || '').trim().toLowerCase();
  return value === 'true' || value === '1';
}

export interface DeterministicStoryChecks {
  budget: WordBudgetProblem[];
  garbles: NameGarble[];
  rollCall: RollCallProblem[];
  /**
   * Enforcement strings ready for the regen feedback list. Empty = clean.
   * ja budget violations stay OUT of here (log-only until the char band is
   * calibrated by a native reader); roll-call is log-only by design.
   */
  problems: string[];
  /** Distinct page numbers behind `problems`, ascending — the targeted-rewrite set. */
  offendingPages: number[];
}

/**
 * All deterministic quality checks over a draft's pages, in one pass.
 * Callers log the full result and (flag-gated) push `problems` into the QC
 * verdict.
 */
export function deterministicStoryChecks(
  pages: { pageNumber: number; text: string }[],
  rosterNames: string[],
  language: string = 'en',
): DeterministicStoryChecks {
  const budget = wordBudgetProblems(pages, language);
  const garbles = findNameGarbles(pages, rosterNames, language);
  const rollCall = rollCallProblems(pages, rosterNames);

  const enforceBudget = language !== 'ja';
  const problems = [
    ...(enforceBudget ? budget.map((b) => b.issue) : []),
    ...garbles.map(
      (g) =>
        `Page ${g.pageNumber} garbles character names ("${g.snippet}") — use each name correctly and separately.`,
    ),
  ];
  const offendingPages = [
    ...new Set([
      ...(enforceBudget ? budget.map((b) => b.pageNumber) : []),
      ...garbles.map((g) => g.pageNumber),
    ]),
  ].sort((a, b) => a - b);

  return { budget, garbles, rollCall, problems, offendingPages };
}
