// Same-folder imports stay relative (vitest resolves no `@/` alias); the
// ramble-extract import is type-only, so esbuild erases it before resolution.
import type { SetupFormState } from './SetupSheet';
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
  const next: SetupFormState = { ...form, captureQuestions: [...form.captureQuestions] };
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

  // Who's-who → naming answers on characterId-linked rows.
  let questionsChanged = false;
  for (const person of facts.people) {
    if (!person.characterId) continue;
    const idx = next.captureQuestions.findIndex((q) => q.characterId === person.characterId);
    if (idx >= 0) {
      const q = next.captureQuestions[idx];
      if (!q.answer || q.answer === SKIP) {
        next.captureQuestions[idx] = { ...q, answer: person.name };
        questionsChanged = true;
      }
    } else {
      const rosterChar = roster.find((c) => c.characterId === person.characterId);
      next.captureQuestions.push({
        id: `ramble_name_${person.characterId}`,
        question: labels.nameQuestionFor(rosterChar ? describeCharacter(rosterChar) : person.name),
        options: [],
        characterId: person.characterId,
        kind: 'naming',
        answer: person.name,
      });
      questionsChanged = true;
    }
  }

  // Global facts → synthetic answered rows (stable ids).
  const factRows: [string, string, string | null][] = [
    ['ramble_location', labels.location, facts.location],
    ['ramble_highlight', labels.highlight, facts.highlight],
    ['ramble_mishap', labels.mishap, facts.mishap],
    ['ramble_child_said', labels.childSaid, facts.childSaid],
  ];
  for (const [id, question, answer] of factRows) {
    if (!answer) continue;
    const idx = next.captureQuestions.findIndex((q) => q.id === id);
    if (idx >= 0) {
      if (next.captureQuestions[idx].answer !== answer) {
        next.captureQuestions[idx] = { ...next.captureQuestions[idx], answer };
        questionsChanged = true;
      }
    } else {
      next.captureQuestions.push({
        id,
        question,
        options: [],
        characterId: null,
        kind: 'other',
        answer,
      });
      questionsChanged = true;
    }
  }
  if (next.captureQuestions.length > 10) {
    next.captureQuestions = next.captureQuestions.slice(0, 10);
  }
  if (questionsChanged) changed.captureQuestions = next.captureQuestions;

  // Theme correction — one tap on the card still wins (touched check).
  if (facts.themeLine && !touched.themeLine && facts.themeLine !== form.themeLine) {
    next.themeLine = facts.themeLine;
    changed.themeLine = facts.themeLine;
  }

  return { form: next, changed };
}
