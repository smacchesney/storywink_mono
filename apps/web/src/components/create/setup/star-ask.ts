import type { CaptureQuestion } from './CaptureChips';
import { describeCharacter, type RosterCharacterLike } from './discovery-feed';

// Matches the ensemble sheet/dedication cap of 4; keeps merged rows within the PATCH bound (≤3 server perception rows + 4 synthetics ≤ 10).
export const MAX_MEMBER_NAMING_QUESTIONS = 4;

/**
 * X17 B3 — when "Everyone!" is tapped, every unnamed member gets a naming
 * chip through the existing characterId-linked question flow. Questions the
 * perception pass already asked are kept; the list stays inside the PATCH
 * schema's max-10 bound.
 */
export function ensureMemberNamingQuestions(
  questions: CaptureQuestion[],
  members: RosterCharacterLike[],
  questionFor: (descriptor: string) => string,
): CaptureQuestion[] {
  const covered = new Set(questions.filter((q) => q.characterId).map((q) => q.characterId));
  const existingNaming = questions.filter((q) => q.id.startsWith('name_')).length;
  const slots = Math.max(0, MAX_MEMBER_NAMING_QUESTIONS - existingNaming);
  const additions: CaptureQuestion[] = members
    .filter((m) => !m.name?.trim() && !covered.has(m.characterId))
    .slice(0, slots)
    .map((m) => ({
      id: `name_${m.characterId}`,
      question: questionFor(describeCharacter(m)),
      options: [],
      characterId: m.characterId,
      kind: 'naming',
      answer: null,
    }));
  return [...questions, ...additions].slice(0, 10);
}

/**
 * X17 B3 review fix — id-preserving merge for the perception poll.
 *
 * `handlePickEveryone` injects synthetic `name_<characterId>` naming rows into
 * local `captureQuestions` WITHOUT marking `touched.current.captureQuestions`
 * (deliberate — so perception's own late-arriving questions can still merge).
 * The gap: while the poll is still live, a tick landing before the debounced
 * PATCH round-trips would otherwise replace the local list wholesale and
 * silently drop those naming chips.
 *
 * This keeps the server list as the base (server order, server wins on any id
 * collision) and re-appends only the local `name_` rows the server has not yet
 * echoed, in their local relative order. When no local `name_` rows exist the
 * server list is returned by reference — byte-identical to the legacy wholesale
 * replacement, so every pre-X17 book is unaffected.
 */
export function mergeCaptureQuestions(
  serverQuestions: CaptureQuestion[],
  localQuestions: CaptureQuestion[],
): CaptureQuestion[] {
  const serverIds = new Set(serverQuestions.map((q) => q.id));
  const survivors = localQuestions.filter((q) => q.id.startsWith('name_') && !serverIds.has(q.id));
  if (survivors.length === 0) return serverQuestions;
  return [...serverQuestions, ...survivors];
}
