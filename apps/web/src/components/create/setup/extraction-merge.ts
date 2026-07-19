// Same-folder imports stay relative (vitest resolves no `@/` alias); the
// ramble-extract import is type-only, so esbuild erases it before resolution.
import type { SetupFormState } from './SetupSheet';
import type { CaptureQuestion } from '@/components/create/setup/CaptureChips';
import type { RambleExtraction } from '@/lib/ramble-extract';
import { CHILD_ROLES, describeCharacter, type RosterCharacterLike } from './discovery-feed';

export interface FactQuestionLabels {
  location: string;
  highlight: string;
  mishap: string;
  childSaid: string;
  nameQuestionFor: (descriptor: string) => string;
}

export interface ExtractionMergeResult {
  form: SetupFormState;
  /** Exactly the fields that changed — the debounced PATCH body. */
  changed: Record<string, unknown>;
}

const SKIP = '__skip__';
const MAX_QUESTIONS = 10;

/**
 * X17 B4 (review fix) — fold extraction facts into a capture-question list,
 * respecting the CURRENT rows. Pure and referentially honest: returns `current`
 * unchanged (same reference) when nothing lands, otherwise a fresh array. The
 * caller runs this INSIDE the setForm updater against `prev.captureQuestions`
 * so a parent answering a chip during the 2-10s extraction round-trip wins —
 * a fact never overwrites a row that already carries a real answer.
 *
 * StrictMode-safe: no closures over mutable state, deterministic output for a
 * given `(current, facts)`, so a double-invoked updater assigns identically.
 */
export function applyExtractionToQuestions(
  current: CaptureQuestion[],
  facts: RambleExtraction,
  roster: RosterCharacterLike[],
  labels: FactQuestionLabels,
): CaptureQuestion[] {
  // Copy-on-write: clone on the first real mutation, otherwise keep `current`
  // so the caller can detect "nothing changed" by reference equality.
  let next = current;
  const mutate = () => {
    if (next === current) next = [...current];
  };

  // Who's-who → naming answers on characterId-linked rows. Fill only blank/skip
  // slots; append a `ramble_name_*` row for people with no row yet (dedupe by
  // characterId keeps re-extraction updating in place instead of duplicating).
  for (const person of facts.people) {
    if (!person.characterId) continue;
    const idx = next.findIndex((q) => q.characterId === person.characterId);
    if (idx >= 0) {
      const q = next[idx];
      if (!q.answer || q.answer === SKIP) {
        mutate();
        next[idx] = { ...q, answer: person.name };
      }
    } else {
      mutate();
      const rosterChar = roster.find((c) => c.characterId === person.characterId);
      next.push({
        id: `ramble_name_${person.characterId}`,
        question: labels.nameQuestionFor(rosterChar ? describeCharacter(rosterChar) : person.name),
        options: [],
        characterId: person.characterId,
        kind: 'naming',
        answer: person.name,
      });
    }
  }

  // Global facts → synthetic answered rows (stable ids; dedupe by id).
  const factRows: [string, string, string | null][] = [
    ['ramble_location', labels.location, facts.location],
    ['ramble_highlight', labels.highlight, facts.highlight],
    ['ramble_mishap', labels.mishap, facts.mishap],
    ['ramble_child_said', labels.childSaid, facts.childSaid],
  ];
  for (const [id, question, answer] of factRows) {
    if (!answer) continue;
    const idx = next.findIndex((q) => q.id === id);
    if (idx >= 0) {
      if (next[idx].answer !== answer) {
        mutate();
        next[idx] = { ...next[idx], answer };
      }
    } else {
      mutate();
      next.push({ id, question, options: [], characterId: null, kind: 'other', answer });
    }
  }

  // Total cap. Synthetic rows append at the tail, so slicing truncates
  // ramble rows first and preserves the parent's original questions.
  if (next.length > MAX_QUESTIONS) {
    mutate();
    next = next.slice(0, MAX_QUESTIONS);
  }

  return next;
}

/**
 * X17 B4 — fold extraction facts into setup state. Parent input always
 * wins: a fact never overwrites a touched field or an existing answer, and
 * synthetic rows are keyed `ramble_*` so re-extraction updates in place.
 * Naming rows ride the existing characterId channel into the worker's
 * roster merge; other rows reach the prompt via buildConfirmedFacts.
 */
export function mergeExtractionFacts(
  form: SetupFormState,
  facts: RambleExtraction,
  roster: RosterCharacterLike[],
  labels: FactQuestionLabels,
  touched: { childName: boolean; themeLine: boolean; castMode: boolean },
): ExtractionMergeResult {
  const next: SetupFormState = { ...form };
  const changed: Record<string, unknown> = {};

  // Star name → childName, only when the parent left it blank.
  if (facts.starName && !touched.childName && !form.childName.trim()) {
    next.childName = facts.starName;
    changed.childName = facts.starName;
  }

  // Star binding: the named star maps to a roster kid → fix the coin flip,
  // unless the parent already picked in the star ask.
  if (facts.starName && !touched.castMode && form.castMode === 'star' && !form.starCharacterId) {
    const starEntry = facts.people.find(
      (p) => p.characterId && p.name.toLowerCase() === facts.starName!.toLowerCase(),
    );
    const rosterMatch = starEntry
      ? roster.find(
          (c) =>
            c.characterId === starEntry.characterId &&
            (CHILD_ROLES as readonly string[]).includes(c.role),
        )
      : undefined;
    if (rosterMatch) {
      next.starCharacterId = rosterMatch.characterId;
      changed.castMode = 'star';
      changed.starCharacterId = rosterMatch.characterId;
    }
  }

  // Capture-question rows are computed by the shared pure helper so the
  // interactive path (page.tsx) can re-run the exact same logic INSIDE its
  // setForm updater against the freshest rows. Referential inequality is the
  // change signal — the helper returns `form.captureQuestions` untouched when
  // nothing lands.
  const nextQuestions = applyExtractionToQuestions(form.captureQuestions, facts, roster, labels);
  next.captureQuestions = nextQuestions;
  if (nextQuestions !== form.captureQuestions) changed.captureQuestions = nextQuestions;

  // Theme correction — one tap on the card still wins (touched check).
  if (facts.themeLine && !touched.themeLine && facts.themeLine !== form.themeLine) {
    next.themeLine = facts.themeLine;
    changed.themeLine = facts.themeLine;
  }

  return { form: next, changed };
}
