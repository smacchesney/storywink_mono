import { StyleKey, getStyleDefinition, StylePromptContext } from './styles.js';
import { CharacterIdentity } from '../types.js';
import type { BridgeScene } from './story.js';

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
  /**
   * BRIDGE pages (source=BRIDGE, no photo of their own): the structured
   * scene authored by the story model. When present, the prompt redefines
   * image 1's role — the ADJACENT photo is an identity/outfit/setting anchor,
   * never a pose to copy — and the identity section filters the roster by
   * scene.charactersPresent instead of appearsOnPages.
   */
  bridgeScene?: BridgeScene | null;
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
  bridgeCharacterIds?: string[] | null,
): string | null {
  if (!characterIdentity?.characters?.length) return null;

  // BRIDGE pages have no perception rows, so appearsOnPages can never match
  // them — filter by the story-authored cast instead. If none of the authored
  // ids resolve (roster re-extracted since the story ran), fall back to the
  // photo-page filter rather than dropping the identity block entirely.
  const bridgeFiltered = bridgeCharacterIds?.length
    ? characterIdentity.characters.filter(c => bridgeCharacterIds.includes(c.characterId))
    : [];

  const relevantCharacters = bridgeFiltered.length
    ? bridgeFiltered
    : pageNumber
      ? characterIdentity.characters.filter(
          c =>
            isMainCharacterRole(c.role) ||
            c.appearsOnPages.includes(pageNumber) ||
            c.appearsOnPages.length === 0,
        )
      : characterIdentity.characters;

  if (relevantCharacters.length === 0) return null;

  // On bridge pages (scene-authored cast applied) the arbitration trailer
  // must agree with the BRIDGE PAGE section: pose/composition are released
  // from the photo there, so claiming "pose ... follow[s] this page's photo"
  // here would reintroduce the exact contradiction the bridge override
  // settles. Photo pages keep the original wording byte-for-byte.
  const arbitrationTrailer = bridgeFiltered.length
    ? `Clothing follows this page's photo (image 1); pose and scene composition follow the BRIDGE PAGE instructions:`
    : `Pose, clothing, and scene composition follow this page's photo:`;

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
    `${arbitrationTrailer}\n` +
    charDescriptions
  );
}

/**
 * BRIDGE pages: overrides the style prompt's default reading of image 1.
 * The anchor is the ADJACENT original photo — ground truth for identity,
 * outfits, and setting continuity — but the moment to depict is NEW. This
 * section must stay consistent with (never contradict) the PEOPLE - SOURCE
 * HIERARCHY: identity still follows the character reference, and the photo
 * still rules outfits — only pose/composition/moment are released.
 */
function buildBridgeSceneSection(bridgeScene: BridgeScene | null | undefined): string | null {
  if (!bridgeScene) return null;

  const props = bridgeScene.props.filter(p => p.trim());
  return [
    `BRIDGE PAGE — THIS PAGE HAS NO PHOTO OF ITS OWN (this section supersedes the SCENE INTERPRETATION instructions above and item 2 of PEOPLE - SOURCE HIERARCHY):`,
    `Image 1 is a PHOTO of the SAME people taken moments around this scene — the same people moments later. On this page it rules ONLY identity, outfits, and setting continuity — do NOT copy its pose, its composition, its moment, or which people are present. People in this scene come ONLY from this scene's cast (the characters described in the CHARACTER IDENTITY section below, when provided); never add other people from the photo.`,
    `DEPICT THIS NEW MOMENT INSTEAD: ${bridgeScene.action}`,
    `Location: ${bridgeScene.location}. Time of day: ${bridgeScene.timeOfDay}.`,
    props.length ? `Include these objects from the surrounding photos: ${props.join(', ')}.` : null,
    `Outfits: exactly as worn in the photo (image 1). The people must be instantly recognizable as the same people from the photo.`,
  ]
    .filter(Boolean)
    .join(' ');
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

  // 2. Bridge pages: re-role image 1 (adjacent photo = anchor, not the scene)
  const bridgeSection = buildBridgeSceneSection(opts.bridgeScene);

  // 3. Cross-cutting: character identity
  const charSection = buildCharacterIdentitySection(
    opts.characterIdentity,
    opts.pageNumber,
    opts.bridgeScene?.charactersPresent ?? null,
  );

  // 4. Cross-cutting: QC feedback
  const qcSection = buildQCFeedbackSection(opts.qcFeedback);

  const prompt = [stylePrompt, bridgeSection, charSection, qcSection].filter(Boolean).join(' ');

  return prompt.length > MAX_PROMPT_CHARS
    ? prompt.slice(0, MAX_PROMPT_CHARS - 1) + '\u2026'
    : prompt;
}
