import type { CharacterIdentity } from '@storywink/shared/types';
import { mergeCastNames, CaptureAnswerLike } from './resolveCast.js';

/**
 * Identity preparation for the X15 sheet pre-warm, mirroring the real
 * extraction pass IN MEMORY only (the prep job must never persist
 * Book.characterIdentity — the story worker is writing it concurrently):
 * capture-answer cast-name merge, then a style-translation refresh whenever
 * the perception stamp targets a different art style. Skipping either would
 * bake wrong-style / unnamed prompt lines into cached sheets that the real
 * pass then reuses by (characterId, artStyle) key alone.
 *
 * Returns the prepared identity, or null when the pre-warm must be skipped
 * (no identity, or the refresh failed — the real pass generates instead).
 */
export async function prepareIdentityForSheetPrewarm(params: {
  identity: CharacterIdentity | null;
  artStyle: string;
  captureQuestions: CaptureAnswerLike[];
  childName: string | null;
  refresh: (identity: CharacterIdentity) => Promise<CharacterIdentity | null>;
}): Promise<CharacterIdentity | null> {
  const { artStyle, captureQuestions, childName, refresh } = params;
  let identity = params.identity;

  if (!identity?.characters?.length) return null;

  const merge = mergeCastNames({
    characters: identity.characters,
    captureQuestions,
    childName,
  });
  if (merge.changed) {
    identity = { ...identity, characters: merge.characters };
  }

  if (identity.extractedForStyle !== artStyle) {
    const refreshed = await refresh(identity);
    if (!refreshed) return null;
    identity = refreshed;
  }

  return identity;
}
