import { StyleKey, getStyleDefinition, StylePromptContext } from './styles.js';
import { CharacterIdentity } from '../types.js';

// ----------------------------------
// TYPES
// ----------------------------------

export interface IllustrationPromptOptions {
  style: StyleKey;
  pageText: string | null;
  bookTitle: string | null;
  isTitlePage?: boolean;
  illustrationNotes?: string | null;
  referenceImageCount?: number;
  characterIdentity?: CharacterIdentity | null;
  pageNumber?: number;
  qcFeedback?: string | null;
  language?: string;
  /** Character sheets sent with the request (between photo and style refs). */
  characterSheetCount?: number;
  /** 1 when the approved interior render rides along as a ref (cover calls). */
  interiorRenderCount?: number;
}

// ----------------------------------
// CONSTANTS
// ----------------------------------

const MAX_PROMPT_CHARS = 30000;

// ----------------------------------
// CROSS-CUTTING HELPERS
// ----------------------------------

/**
 * Roles are free-form strings from the perception pass ('main_child',
 * 'parent', 'grandparent', ...). Main characters must never be dropped from
 * the identity section by a perception miss in appearsOnPages — the ambiguous
 * photos where perception missed them are exactly the pages that need the
 * canonical description most.
 */
export function isMainCharacterRole(role: string): boolean {
  return role.startsWith('main');
}

function buildCharacterIdentitySection(
  characterIdentity: CharacterIdentity | null | undefined,
  pageNumber: number | undefined,
): string | null {
  if (!characterIdentity?.characters?.length) return null;

  const relevantCharacters = pageNumber
    ? characterIdentity.characters.filter(
        c =>
          isMainCharacterRole(c.role) ||
          c.appearsOnPages.includes(pageNumber) ||
          c.appearsOnPages.length === 0,
      )
    : characterIdentity.characters;

  if (relevantCharacters.length === 0) return null;

  const charDescriptions = relevantCharacters
    .map(c => {
      const traits = c.physicalTraits;
      return [
        `- ${c.name || c.characterId} (${c.role}):`,
        `  Age: ${traits.apparentAge}`,
        `  Hair: ${traits.hairColor}, ${traits.hairStyle}`,
        `  Skin tone: ${traits.skinTone}`,
        `  Build: ${traits.bodyBuild}`,
        traits.distinguishingFeatures.length > 0
          ? `  Distinguishing features: ${traits.distinguishingFeatures.join(', ')}`
          : null,
        `  Typical clothing (this page's photo takes precedence): ${c.typicalClothing}`,
        c.styleTranslation ? `  Style rendering: ${c.styleTranslation}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return (
    `CHARACTER IDENTITY (canonical reference — wins on face, hair, and skin):\n` +
    `The following characters appear in this scene. Their face shape, hair, skin tone, and distinguishing features MUST match these descriptions on every page; ` +
    `when the photo is ambiguous or disagrees on those features (lighting, angle, shadow), these descriptions win. ` +
    `Pose, clothing, and scene composition follow this page's photo:\n` +
    charDescriptions
  );
}

function buildQCFeedbackSection(qcFeedback: string | null | undefined): string | null {
  if (!qcFeedback) return null;

  return (
    `CRITICAL CORRECTIONS (from quality check - MUST be addressed):\n` +
    `A previous version of this illustration was flagged for the following issues. ` +
    `You MUST fix ALL of the following problems in this version:\n` +
    qcFeedback
  );
}

// ----------------------------------
// PROMPT ASSEMBLER
// ----------------------------------

/**
 * Creates a prompt for illustration generation by delegating to the style's
 * prompt builder and appending cross-cutting concerns (character identity, QC feedback).
 */
export function createIllustrationPrompt(opts: IllustrationPromptOptions): string {
  const style = getStyleDefinition(opts.style);
  const ctx: StylePromptContext = {
    bookTitle: opts.bookTitle,
    pageText: opts.pageText,
    illustrationNotes: opts.illustrationNotes ?? null,
    referenceImageCount: opts.referenceImageCount || 1,
    language: opts.language,
    characterSheetCount: opts.characterSheetCount ?? 0,
    interiorRenderCount: opts.interiorRenderCount ?? 0,
  };

  // 1. Style-specific prompt (the bulk of the prompt)
  const stylePrompt = opts.isTitlePage
    ? style.buildCoverPrompt(ctx)
    : style.buildInteriorPrompt(ctx);

  // 2. Cross-cutting: character identity
  const charSection = buildCharacterIdentitySection(opts.characterIdentity, opts.pageNumber);

  // 3. Cross-cutting: QC feedback
  const qcSection = buildQCFeedbackSection(opts.qcFeedback);

  const prompt = [stylePrompt, charSection, qcSection].filter(Boolean).join(' ');

  return prompt.length > MAX_PROMPT_CHARS
    ? prompt.slice(0, MAX_PROMPT_CHARS - 1) + '\u2026'
    : prompt;
}
