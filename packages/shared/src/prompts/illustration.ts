import { StyleKey, getStyleDefinition, StylePromptContext } from './styles.js';
import { CharacterIdentity } from '../types.js';
import type { BridgeScene, AvatarPageScene } from './story.js';

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
  /**
   * A4: ordered name↔sheet map for the sheet-anchored (avatar) branch — one
   * entry per sheet actually sent, image 1 first. Computed worker-side
   * (speciesLineFor); the prompt only renders it. Ignored on non-sheet paths.
   */
  sheetRoster?: { name: string; species: string }[];
  /** 1 when the approved interior render rides along as a ref (cover calls). */
  interiorRenderCount?: number;
  /**
   * BRIDGE pages (source=BRIDGE, no photo of their own): the structured
   * scene authored by the story model. When present, the prompt redefines
   * image 1's role — the ADJACENT photo is an identity/outfit/setting anchor,
   * never a pose to copy — and the identity section filters the roster by
   * scene.charactersPresent instead of appearsOnPages.
   */
  bridgeScene?: BridgeScene | AvatarPageScene | null;
  /**
   * AVATAR_STORY (X6d): role of image 1. 'photo' (default) keeps every
   * existing prompt byte-identical. 'sheet' = a character turnaround sheet
   * anchors the render (no photo exists anywhere in the book); the scene
   * comes from bridgeScene (or the page text when the scene failed
   * validation). 'interior' = the approved interior render of the cover
   * scene anchors the cover repaint.
   */
  contentAnchor?: 'photo' | 'sheet' | 'interior';
}

// ----------------------------------
// CONSTANTS
// ----------------------------------

const MAX_PROMPT_CHARS = 30000;

/**
 * The single no-text rule for INTERIOR pages. Assembled LAST so it is the final
 * instruction the model reads (both avatar and photo paths). Covers are
 * excluded — they render a bounded title handled by the cover style prompt.
 */
const ABSOLUTELY_NO_TEXT_RULE =
  'ABSOLUTELY NO TEXT: Do not render any letters, words, numbers, captions, labels, speech bubbles, sound effects, or title text anywhere in the image. This is a wordless illustration.';

// ----------------------------------
// ILLUSTRATION-NOTES SANITIZER
// ----------------------------------

/** What a shouty token becomes — a wordless stand-in the effect line can act on. */
const SOUND_WORD_REPLACEMENT = 'sound-effect energy';

/** Quoted spans are shouty when they exclaim ("Peekaboo!") or are ALL-CAPS ("TICKA-TICKA"). */
function isShoutyToken(inner: string): boolean {
  const token = inner.trim();
  if (!/[A-Za-z]/.test(token)) return false;
  if (token.endsWith('!')) return true;
  return !/[a-z]/.test(token) && /[A-Z]{2}/.test(token);
}

/**
 * Stored illustrationNotes from older books (and story-model disobedience) can
 * QUOTE sound-words — `tiny "TICKA-TICKA" by its tongue` — which the model
 * renders as lettering even against the final no-text rule. Deterministically
 * rewrite shouty tokens (quoted exclamations or ALL-CAPS spans, standalone
 * ALL-CAPS! words, bare ALL-CAPS hyphen-repeats) into a wordless placeholder
 * before the notes enter ANY prompt path.
 */
export function sanitizeIllustrationNotes(notes: string | null): string | null {
  if (!notes) return notes;
  let out = notes;
  // Quoted shouty tokens: "TICKA-TICKA", “POOF!”, 'Peekaboo!'
  out = out.replace(/["“”'‘’]([^"“”'‘’]{1,80})["“”'‘’]/g, (match, inner: string) =>
    isShoutyToken(inner) ? SOUND_WORD_REPLACEMENT : match,
  );
  // Standalone ALL-CAPS tokens ending in ! (POOF!), then bare hyphen-repeats (TICKA-TICKA).
  out = out.replace(/\b[A-Z]{2,}(?:-[A-Z]{2,})*!+/g, SOUND_WORD_REPLACEMENT);
  out = out.replace(/\b[A-Z]{2,}(?:-[A-Z]{2,})+\b/g, SOUND_WORD_REPLACEMENT);
  // Tidy: a run of adjacent replacements collapses to one; no doubled spaces.
  return out
    .replace(/sound-effect energy(?:[,\s]+sound-effect energy)+/g, SOUND_WORD_REPLACEMENT)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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
  sheetAnchored = false,
): string | null {
  if (!characterIdentity?.characters?.length) return null;

  // BRIDGE pages have no perception rows, so appearsOnPages can never match
  // them — filter by the story-authored cast instead. If none of the authored
  // ids resolve (roster re-extracted since the story ran), fall back to the
  // photo-page filter rather than dropping the identity block entirely.
  const bridgeFiltered = bridgeCharacterIds?.length
    ? characterIdentity.characters.filter((c) => bridgeCharacterIds.includes(c.characterId))
    : [];

  const relevantCharacters = bridgeFiltered.length
    ? bridgeFiltered
    : pageNumber
      ? characterIdentity.characters.filter(
          (c) =>
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
  // Sheet-anchored pages (X6d): no photo exists at all — clothing and
  // identity follow the CHARACTER SHEETS, composition follows the scene.
  const arbitrationTrailer = sheetAnchored
    ? `Face, hair, skin tone, proportions, and clothing follow the CHARACTER SHEETS; pose and scene composition follow the AVATAR STORY PAGE instructions:`
    : bridgeFiltered.length
      ? `Clothing follows this page's photo (image 1); pose and scene composition follow the BRIDGE PAGE instructions:`
      : `Pose, clothing, and scene composition follow this page's photo:`;

  const clothingPrecedence = sheetAnchored
    ? `the CHARACTER SHEET takes precedence`
    : `this page's photo takes precedence`;

  const charDescriptions = relevantCharacters
    .map((c) => {
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
        `  Typical clothing (${clothingPrecedence}): ${c.typicalClothing}`,
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

  const props = bridgeScene.props.filter((p) => p.trim());
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

/**
 * AVATAR_STORY pages (X6d): the whole book is photo-less; image 1 is a
 * character turnaround sheet. Like the bridge section, this supersedes the
 * style bible's SCENE INTERPRETATION reading of image 1 and item 2 of the
 * PEOPLE - SOURCE HIERARCHY. The scene comes from the story model; when the
 * scene failed validation, the page text carries the moment instead.
 */
function buildAvatarSceneSection(
  scene: AvatarPageScene | BridgeScene | null | undefined,
  pageText: string | null,
): string {
  // Empty scene cast = a deliberate establishing shot: the instruction must
  // say NOBODY appears, not fall back to describing the whole roster.
  const sceneIsEmpty = !!scene && scene.charactersPresent.length === 0;
  const header = `AVATAR STORY PAGE — THIS BOOK HAS NO PHOTOS (this section supersedes the SCENE INTERPRETATION instructions above and item 2 of PEOPLE - SOURCE HIERARCHY): Image 1 is a CHARACTER SHEET, not a scene — nothing of its 2x2 grid layout, neutral poses, or plain background may appear in the illustration. Compose a brand-new scene from the instructions below. ${
    sceneIsEmpty
      ? `This page is a scene-setting moment: NO characters appear — paint the setting only, no people, pets, or toys.`
      : `People in this scene come ONLY from this scene's cast (the characters described in the CHARACTER IDENTITY section below, when provided); their faces, hair, skin tone, proportions, and outfits follow their CHARACTER SHEETS exactly.`
  }`;

  if (!scene) {
    return [
      header,
      `Compose the moment this page's story text describes (the moment to depict, not caption copy)${
        pageText ? `: "${pageText}"` : '.'
      }`,
    ].join(' ');
  }

  const props = scene.props.filter((p) => p.trim());
  return [
    header,
    `Compose this moment: ${scene.action}.`,
    `Set the scene in ${scene.location}, at ${scene.timeOfDay}.`,
    props.length ? `The following objects should appear in the scene: ${props.join(', ')}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * A5: on avatar-story pages that name a cast, list the EXACT set of characters
 * so the model draws each exactly once and adds no stray people or creatures.
 * Names are resolved through the roster — the same list that filters
 * buildCharacterIdentitySection. Establishing shots (empty charactersPresent)
 * emit nothing; their header already says "paint the setting only".
 */
function buildExactCastSection(
  characterIdentity: CharacterIdentity | null | undefined,
  scene: AvatarPageScene | BridgeScene | null | undefined,
): string | null {
  if (!scene || scene.charactersPresent.length === 0) return null;

  const present = new Set(scene.charactersPresent);
  const names = (characterIdentity?.characters ?? [])
    .filter((c) => present.has(c.characterId))
    .map((c) => c.name || c.characterId);
  if (names.length === 0) return null;

  return (
    `Draw EXACTLY these characters, each exactly once and no more: ${names.join(', ')}. ` +
    `Do not duplicate any character. If two figures look identical, you have drawn the same character twice — draw each character exactly once. ` +
    `Do not add any other people, animals, or creatures unless this scene's objects call for them.`
  );
}

/**
 * AVATAR_STORY covers: image 1 is the approved interior render of the cover
 * scene — the cover repaints that scene, with the sheets as identity truth.
 */
function buildInteriorAnchorSection(): string {
  return `COVER ANCHOR (this section supersedes the SCENE INTERPRETATION instructions above and item 2 of PEOPLE - SOURCE HIERARCHY): Image 1 is this book's approved interior illustration of the cover scene — repaint the SAME scene, people, and palette as a cover composition. Identity (face, hair, skin tone, proportions) follows the CHARACTER SHEETS when provided.`;
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
  const contentAnchor = opts.contentAnchor ?? 'photo';
  const ctx: StylePromptContext = {
    bookTitle: opts.bookTitle,
    pageText: opts.pageText,
    illustrationNotes: sanitizeIllustrationNotes(opts.illustrationNotes ?? null),
    referenceImageCount: opts.referenceImageCount || 1,
    language: opts.language,
    characterSheetCount: opts.characterSheetCount ?? 0,
    interiorRenderCount: opts.interiorRenderCount ?? 0,
    contentAnchor,
    sheetRoster: opts.sheetRoster,
  };

  // 1. Style-specific prompt (the bulk of the prompt)
  const stylePrompt = opts.isTitlePage
    ? style.buildCoverPrompt(ctx)
    : style.buildInteriorPrompt(ctx);

  // 2. Re-role image 1 when it is not this page's photo:
  //    - bridge pages: the ADJACENT photo anchors identity, not the scene
  //    - avatar-story pages ('sheet'): a character sheet anchors, the scene
  //      comes from the story model (or the page text)
  //    - avatar-story covers ('interior'): the approved interior render
  //      anchors the cover repaint
  const bridgeSection =
    contentAnchor === 'sheet'
      ? buildAvatarSceneSection(opts.bridgeScene, opts.pageText)
      : contentAnchor === 'interior'
        ? buildInteriorAnchorSection()
        : buildBridgeSceneSection(opts.bridgeScene as BridgeScene | null | undefined);

  // 3. Cross-cutting: character identity.
  // Sheet-anchored pages with a scene that names NOBODY (a wide establishing
  // shot, or every authored id failed roster validation) must not fall back
  // to the whole-roster filter — every avatar roster entry has
  // appearsOnPages: [], so the fallback would assert the ENTIRE cast into a
  // deliberately empty scene.
  const emptySceneCast =
    contentAnchor === 'sheet' &&
    opts.bridgeScene != null &&
    opts.bridgeScene.charactersPresent.length === 0;
  const charSection = emptySceneCast
    ? null
    : buildCharacterIdentitySection(
        opts.characterIdentity,
        opts.pageNumber,
        opts.bridgeScene?.charactersPresent ?? null,
        contentAnchor === 'sheet' || contentAnchor === 'interior',
      );

  // 4. A5 exact-cast constraint (avatar-story pages only — the only path with a
  //    structured scene cast; forbids duplicates and stray creatures).
  const exactCastSection =
    contentAnchor === 'sheet'
      ? buildExactCastSection(opts.characterIdentity, opts.bridgeScene)
      : null;

  // 5. Cross-cutting: QC feedback
  const qcSection = buildQCFeedbackSection(opts.qcFeedback);

  // 6. The no-text rule lands LAST for INTERIOR pages (both avatar and photo
  //    paths). Covers are excluded — they render a bounded title.
  const noTextSection = opts.isTitlePage ? null : ABSOLUTELY_NO_TEXT_RULE;

  const prompt = [
    stylePrompt,
    bridgeSection,
    charSection,
    exactCastSection,
    qcSection,
    noTextSection,
  ]
    .filter(Boolean)
    .join(' ');

  return prompt.length > MAX_PROMPT_CHARS
    ? prompt.slice(0, MAX_PROMPT_CHARS - 1) + '\u2026'
    : prompt;
}
