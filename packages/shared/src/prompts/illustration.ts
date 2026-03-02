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
}

// ----------------------------------
// CONSTANTS
// ----------------------------------

const MAX_PROMPT_CHARS = 30000;

// ----------------------------------
// CROSS-CUTTING HELPERS
// ----------------------------------

function buildCharacterIdentitySection(
  characterIdentity: CharacterIdentity | null | undefined,
  pageNumber: number | undefined,
): string | null {
  if (!characterIdentity?.characters?.length) return null;

  const relevantCharacters = pageNumber
    ? characterIdentity.characters.filter(
        c => c.appearsOnPages.includes(pageNumber) || c.appearsOnPages.length === 0,
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
        `  Clothing: ${c.typicalClothing}`,
        c.styleTranslation ? `  Style rendering: ${c.styleTranslation}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return (
    `CHARACTER IDENTITY (MANDATORY - override any visual ambiguity with these specifications):\n` +
    `The following characters appear in this scene. Their appearance MUST match these exact descriptions across ALL pages. ` +
    `If the source photo is ambiguous (lighting, angle, shadow), defer to these canonical descriptions:\n` +
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
