/**
 * Provider-conditional neutral-name mode (X12-D Track D flip-prep).
 *
 * `neutralizeCharacterNames` (shared IllustrationPromptOptions) replaces every
 * roster display name with a neutral `Character N` token on the avatar prompt
 * paths. It is PROVEN necessary for OpenAI — name-semantics beats reference
 * sheets there ("Grypho" was drawn as a griffin) — and deliberately NOT
 * validated for Gemini (Track A validated Gemini WITH names). So it must turn
 * on exactly when the OpenAI provider renders, and stay off otherwise.
 *
 * Derive the decision from the provider instance that ACTUALLY executes the
 * render (`illustrator.name`), so it stays correct across the default provider,
 * the QC escalation illustrator, and the D5 Gemini content-policy fallback.
 * (Neutral mode is a no-op on the photo path and byte-identical when off, so
 * threading it unconditionally by provider is safe for every book type.)
 */

import type { IllustrationProviderName } from './types.js';

/** Neutral names on iff the executing provider is OpenAI. */
export function shouldNeutralizeNames(providerName: IllustrationProviderName): boolean {
  return providerName === 'openai';
}
