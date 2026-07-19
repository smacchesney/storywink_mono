// Relative import (not `@/`) — the root vitest config resolves no `@/` alias
// (see overlay-view-math.ts:14). Type-only would be erased anyway; relative
// keeps every module in this folder loadable under vitest regardless.
import type { SetupFormState } from './SetupSheet';

/**
 * The PATCH body the setup submit sends. Pure — mirrors the exact legacy
 * field rules (optionals ride only when non-empty, setup/page.tsx submit)
 * plus the X17b theme/cast fields, which only ever appear when the
 * discovery surface populated them, so legacy books submit byte-identical
 * bodies.
 */
export function buildSubmitPatchBody(form: SetupFormState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    childName: form.childName.trim(),
    artStyle: form.artStyle,
    autoIllustrate: !form.reviewFirst,
  };
  if (form.title.trim()) body.title = form.title.trim();
  if (form.eventSummary.trim()) body.eventSummary = form.eventSummary.trim();
  if (form.tone) body.tone = form.tone;
  if (form.learningWords.length > 0)
    body.learningWords = form.learningWords.map((word) => ({ word }));
  if (form.captureQuestions.length > 0) body.captureQuestions = form.captureQuestions;
  if (form.themeLine.trim()) body.themeLine = form.themeLine.trim();
  if (form.starCharacterId) {
    body.castMode = 'star';
    body.starCharacterId = form.starCharacterId;
  }
  if (form.castMode === 'ensemble' && form.castMemberIds.length > 0) {
    body.castMode = 'ensemble';
    body.castMemberIds = form.castMemberIds;
    body.starCharacterId = null;
  }
  return body;
}
