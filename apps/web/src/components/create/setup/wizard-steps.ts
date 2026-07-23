/**
 * Pure rules for the X18 guided-setup wizard. No React, no DOM — everything
 * here is unit-tested and consumed by SetupWizard/steps/page for rendering
 * and behavior.
 */
import {
  STRIP_FACES_AT_MS,
  STRIP_READING_AT_MS,
  type StripPhase,
} from './strip-phase';
import type { CaptureQuestion } from './CaptureChips';

export type WizardStepId = 1 | 2 | 3 | 4;
export const WIZARD_STEP_COUNT = 4;

export type Step3State = 'reading' | 'landed' | 'settledEmpty';

export interface Step3Payload {
  rosterCount: number;
  chipCount: number;
  themeLine: string;
  perceptionQuestionCount: number;
}

/**
 * Questions that prove perception landed. `ramble_*` rows are extraction
 * facts (parent-authored input), `name_*` rows are synthetic naming rows
 * injected by handlePickEveryone/extraction — neither counts.
 */
export function perceptionQuestionCount(questions: CaptureQuestion[]): number {
  return questions.filter((q) => !q.id.startsWith('ramble_') && !q.id.startsWith('name_')).length;
}

/**
 * Step-3 resolution. A photo-mutation re-read (reReading) wins over any
 * retained stale payload; otherwise actual payload beats the sticky
 * 'settled' phase, and only perception-authored artifacts count.
 */
export function deriveStep3State(
  phase: StripPhase,
  p: Step3Payload,
  reReading: boolean,
): Step3State {
  if (reReading) return 'reading';
  // themeLine alone can't end the reading state: ramble extraction may fill
  // it from the parent's own words while photo analysis is still running
  // (adversarial review #9). Roster/chips/perception-questions only ever
  // come from a landed analysis, so they flip regardless of phase.
  const themeCounts = phase !== 'reading' && p.themeLine.trim().length > 0;
  const hasPayload =
    p.rosterCount > 0 || p.chipCount > 0 || themeCounts || p.perceptionQuestionCount > 0;
  if (hasPayload) return 'landed';
  return phase === 'reading' ? 'reading' : 'settledEmpty';
}

export function canLeaveStep1(childName: string): boolean {
  return childName.trim().length > 0;
}

/** Deep-link guard: clamp to 1..4; anything past step 1 needs a name. */
export function guardStep(requested: number | null, childName: string): WizardStepId {
  const clamped = Math.min(Math.max(requested ?? 1, 1), WIZARD_STEP_COUNT);
  const step = (Number.isFinite(clamped) ? clamped : 1) as WizardStepId;
  if (step > 1 && !canLeaveStep1(childName)) return 1;
  return step;
}

export function parseStepParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('step');
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Photo edits refresh perception, which replaces the roster unconditionally
 * while freezing an answered question set (photo-analysis.worker.ts:196-215).
 * Drop question rows bound to characters that no longer exist so a removed
 * person's answer can never become an unbound story fact.
 */
export function filterStaleCastAnswers(
  questions: CaptureQuestion[],
  rosterIds: ReadonlySet<string>,
): CaptureQuestion[] {
  return questions.filter((q) => !q.characterId || rosterIds.has(q.characterId));
}

/**
 * Optional steps the parent ADVANCED PAST without touching. Keyed on
 * advanced-from (Next left the step), not visited — a recap inspection from
 * step 4 followed by Back is not a skip (adversarial review #12).
 */
export function skippedSteps(
  advancedFrom: ReadonlySet<WizardStepId>,
  interacted: ReadonlySet<WizardStepId>,
): WizardStepId[] {
  return ([2, 3] as WizardStepId[]).filter((s) => advancedFrom.has(s) && !interacted.has(s));
}

export type RibbonLineKey =
  | 'stripPeeking'
  | 'stripFaces'
  | 'stripReading'
  | 'foundForStep3'
  | 'stripRest';

/**
 * Reading-ribbon copy key. Staged narration while reading (same schedule as
 * LibrarianStrip); a single handoff line on arrival; the quiet rest line when
 * the poll capped out. No counter — perception persists in one transaction,
 * so a live tally would be theater pretending to be data.
 */
export function ribbonLineKey(phase: StripPhase, elapsedMs: number): RibbonLineKey | null {
  switch (phase) {
    case 'hidden':
      return null;
    case 'reading':
      if (elapsedMs < STRIP_FACES_AT_MS) return 'stripPeeking';
      if (elapsedMs < STRIP_READING_AT_MS) return 'stripFaces';
      return 'stripReading';
    case 'arrived':
    case 'arrivedQuiet':
      return 'foundForStep3';
    case 'settled':
      return 'stripRest';
  }
}

/** How long a photo mutation keeps the re-read narration alive when nothing
 * observable changes. A remove leaves stale analysis on every remaining page
 * (verified: page DELETE rewrites only index/pageNumber/isTitlePage and
 * enqueues refresh:true), so "refresh landed" has no clean signal — bounded
 * honesty instead. */
export const REREAD_WINDOW_MS = 60_000;

/** While re-reading, the strip must not announce arrival off STALE data. */
export function suppressArrival(reReading: boolean, contentChanged: boolean): boolean {
  return reReading && !contentChanged;
}

/**
 * Normalized perception-content hash for re-read completion detection.
 * Excludes answers (the parent's), `ramble_*` rows (extraction churn), and
 * `name_*` rows (synthetic) — otherwise the parent's own edits would falsely
 * "complete" a re-read. themeLine is excluded for the same reason (parent-
 * editable; refresh only writes it when blank).
 */
export function perceptionSnapshot(
  identity: unknown,
  questions: CaptureQuestion[] | null | undefined,
): string {
  const perceptionRows = (questions ?? [])
    .filter((q) => !q.id.startsWith('ramble_') && !q.id.startsWith('name_'))
    .map((q) => ({ id: q.id, question: q.question, options: q.options }));
  return JSON.stringify({ identity: identity ?? null, questions: perceptionRows });
}

/**
 * Wizard live-persistence body for one field edit, or null when the field
 * doesn't live-persist. An undefined-valued key CANCELS a pending value in
 * the debouncer (Object.assign overwrites; JSON.stringify drops undefined) —
 * clearing "Kai" mid-debounce must not let "Kai" flush later. Name/title
 * never PATCH empty (title's schema is min(1); an unaccepted name prefill
 * must not stick). tone: null is a real deselect (schema nullable).
 */
export function livePatchFor(key: string, value: unknown): Record<string, unknown> | null {
  switch (key) {
    case 'childName': {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      return { childName: trimmed ? trimmed : undefined };
    }
    case 'title': {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      return { title: trimmed ? trimmed : undefined };
    }
    case 'tone':
      return { tone: value };
    case 'artStyle':
      return { artStyle: value };
    default:
      return null;
  }
}

/**
 * Pure model of the shell's history protocol — user navigations PUSH (which
 * truncates forward entries, exactly like history.pushState), guards
 * REPLACE. The shell mirrors these semantics onto the real History API; the
 * tests above pin the invariants (back-then-next must not corrupt the stack,
 * recap jumps are Back-able).
 */
export interface HistModel {
  entries: number[];
  pos: number;
}

export function histInit(step: number): HistModel {
  return { entries: [step], pos: 0 };
}

export function histPush(m: HistModel, step: number): HistModel {
  const entries = [...m.entries.slice(0, m.pos + 1), step];
  return { entries, pos: entries.length - 1 };
}

export function histReplace(m: HistModel, step: number): HistModel {
  const entries = [...m.entries];
  entries[m.pos] = step;
  return { entries, pos: m.pos };
}

export function histBack(m: HistModel): HistModel {
  return { entries: m.entries, pos: Math.max(0, m.pos - 1) };
}

export function histForward(m: HistModel): HistModel {
  return { entries: m.entries, pos: Math.min(m.entries.length - 1, m.pos + 1) };
}
