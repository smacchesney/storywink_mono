import type { CaptureQuestion } from './CaptureChips';
import { describeCharacter, type RosterCharacterLike } from './discovery-feed';

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
  const additions: CaptureQuestion[] = members
    .filter((m) => !m.name?.trim() && !covered.has(m.characterId))
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
