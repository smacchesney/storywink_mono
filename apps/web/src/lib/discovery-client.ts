/**
 * X17 Wave B client gates — baked at build time (Dockerfile ARG + turbo env
 * allowlist), so these are constants: the whole discovery surface is
 * byte-identically absent when false, the same D7 pattern as
 * NEXT_PUBLIC_STORY_HELPER_ENABLED (create/characters/page.tsx:103).
 */
export const CREATE_DISCOVERY_FLAG = process.env.NEXT_PUBLIC_CREATE_DISCOVERY_ENABLED === 'true';

/** Hides the "Everyone!" chip only — the star picker itself always rides
 * CREATE_DISCOVERY_FLAG (it fixes the wrong-sibling coin flip solo). */
export const ENSEMBLE_BOOKS_FLAG = process.env.NEXT_PUBLIC_ENSEMBLE_BOOKS_ENABLED === 'true';

/** X18: the guided 4-step setup wizard. Off (default) keeps today's
 * SetupSheet byte-for-byte. */
export const CREATE_WIZARD_FLAG = process.env.NEXT_PUBLIC_CREATE_WIZARD_ENABLED === 'true';

/** X18: the single gate every wizard behavior branches on. Wizard-on with
 * discovery-off must render AND behave exactly like flag-off (Sol review:
 * gating behavior on CREATE_WIZARD_FLAG alone would change polling on the
 * fallback sheet). */
export const WIZARD_ENABLED = CREATE_WIZARD_FLAG && CREATE_DISCOVERY_FLAG;
