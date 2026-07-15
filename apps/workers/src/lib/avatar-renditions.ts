/**
 * Account-avatar rendition pipeline: source photos (or a prior rendition)
 * → single-subject identity → styled 2x2 turnaround sheet → gpt-5-mini
 * validation → upload into storywink/avatars/<avatarId>/.
 *
 * Reuses the book character-sheet core (prompts, provider, validation,
 * style exemplars) with the three book-coupled edges swapped out: photo
 * sourcing is direct, uploads target the avatar folder, persistence is the
 * AvatarRendition row (owned by the worker, not this module).
 *
 * Policy note: photo-input generation is ALWAYS forced onto Gemini — OpenAI
 * refuses edits of photos containing real children, so gpt-image-2 can never
 * back the photo→avatar step (it remains a fine downstream page renderer).
 */
import { v2 as cloudinary } from 'cloudinary';
import OpenAI from 'openai';
import pino from 'pino';
import sharp from 'sharp';
import {
  createCharacterSheetPrompt,
  createSheetValidationPrompt,
  createAvatarIdentityPrompt,
  createCharacterCutoutPrompt,
  createCutoutValidationPrompt,
  SHEET_VALIDATION_SYSTEM_PROMPT,
  SHEET_VALIDATION_RESPONSE_SCHEMA,
  CUTOUT_VALIDATION_SYSTEM_PROMPT,
  CUTOUT_VALIDATION_RESPONSE_SCHEMA,
  CHARACTER_IDENTITY_RESPONSE_SCHEMA,
  type SheetCharacterInput,
  type CutoutCharacterInput,
} from '@storywink/shared/prompts/character-identity';
import { getStyleBible, isValidStyle, STYLE_LIBRARY } from '@storywink/shared/prompts/styles';
import { optimizeCloudinaryUrlForVision } from '@storywink/shared/utils';
import { avatarGeneratedFolderPrefix, extractCloudinaryPublicId } from '@storywink/shared';
import { GeminiProvider } from './illustrators/gemini.js';
import type { IllustrationProvider } from './illustrators/types.js';
import { fetchImageInput } from './images.js';
import { matteWhiteBackground, isUsableMatte } from './cutout-matte.js';
import {
  parseSheetValidationVerdict,
  type SheetValidationVerdict,
} from './avatar-renditions.helpers.js';
import { ANALYSIS_MODEL } from '../config/models.js';

type Logger = pino.Logger;

const STYLE_EXEMPLARS_FOR_SHEET = 2;
const MAX_SOURCE_PHOTOS = 3;
const MAX_GENERATION_ROUNDS = 2;

/** Role string stored on the identity, by avatar kind. */
export const AVATAR_KIND_ROLES: Record<string, string> = {
  CHILD: 'main_child',
  ADULT: 'adult',
  PET: 'pet',
  TOY: 'companion_object',
};

/** The identity JSON stored on Avatar.identity. */
export interface AvatarIdentity {
  character: CutoutCharacterInput & { appearsOnPages?: number[] };
  extractedForStyle: string;
}

let geminiProvider: IllustrationProvider | null = null;
/** Photo-input steps run on Gemini regardless of ILLUSTRATION_PROVIDER. */
function getGemini(): IllustrationProvider {
  if (!geminiProvider) geminiProvider = new GeminiProvider();
  return geminiProvider;
}

export interface ExtractAvatarIdentityParams {
  openai: OpenAI;
  kind: string;
  displayName: string;
  artStyle: string;
  sourceUrls: string[];
  logger: Logger;
  /**
   * Per-subject description from the detect stage. Anchors extraction to the
   * right figure in a group photo (X11 Track F). Optional everywhere — the
   * studio and relearn paths pass nothing.
   */
  subjectDescription?: string;
}

/** One gpt-5-mini vision call: photos of one subject → CharacterDescription. */
export async function extractAvatarIdentity(
  params: ExtractAvatarIdentityParams,
): Promise<AvatarIdentity> {
  const { openai, kind, displayName, artStyle, sourceUrls, logger, subjectDescription } = params;
  const prompt = createAvatarIdentityPrompt({
    kind,
    displayName,
    artStyle,
    photoCount: sourceUrls.length,
    subjectDescription,
  });

  const response = await openai.responses.create({
    model: ANALYSIS_MODEL,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt.text },
          ...sourceUrls.map((url) => ({
            type: 'input_image' as const,
            image_url: optimizeCloudinaryUrlForVision(url),
            detail: 'high' as const,
          })),
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'character_identity',
        strict: true,
        schema: CHARACTER_IDENTITY_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
  });

  const parsed = JSON.parse(response.output_text) as {
    characters: Array<CutoutCharacterInput & { appearsOnPages?: number[] }>;
  };
  const wantedRole = AVATAR_KIND_ROLES[kind] ?? 'adult';
  const character = parsed.characters.find((c) => c.role === wantedRole) ?? parsed.characters[0];
  if (!character) throw new Error('Avatar identity extraction returned no subject');

  logger.info(
    { kind, role: character.role, traits: character.physicalTraits?.hairColor },
    'Avatar identity extracted',
  );
  return {
    character: { ...character, name: displayName },
    extractedForStyle: artStyle,
  };
}

/**
 * The sheet prompt's styleTranslation must describe the TARGET style. When a
 * rendition is requested in a different style than the identity was extracted
 * for, substitute a neutral instruction rather than letting stale prose fight
 * the style bible. (A per-style text refresh is a later polish.)
 */
export function sheetSubjectForStyle(
  identity: AvatarIdentity,
  artStyle: string,
): SheetCharacterInput {
  if (identity.extractedForStyle === artStyle) return identity.character;
  return {
    ...identity.character,
    styleTranslation:
      'Render this subject faithfully in the target art style while keeping every physical trait above instantly recognizable.',
  };
}

/** The cutout subject: the style-corrected sheet subject plus the canonical outfit. */
export function cutoutSubjectForStyle(
  identity: AvatarIdentity,
  artStyle: string,
): CutoutCharacterInput {
  return {
    ...sheetSubjectForStyle(identity, artStyle),
    typicalClothing: identity.character.typicalClothing ?? null,
  };
}

export interface GenerateAvatarSheetParams {
  openai: OpenAI;
  avatarId: string;
  artStyle: string;
  subject: SheetCharacterInput;
  /** Source images: real photos (studio) or a prior rendition sheet (new style). */
  sourceUrls: string[];
  logger: Logger;
}

export interface AvatarSheetResult {
  turnaroundSheetUrl: string;
  portraitUrl: string;
  provider: string;
  model: string;
  validated: boolean;
}

/** Portrait = the sheet's front-view panel (top-left quadrant crop). */
export function portraitUrlFromSheet(sheetUrl: string): string {
  if (!sheetUrl.includes('/image/upload/')) return sheetUrl;
  return sheetUrl.replace('/upload/', '/upload/c_crop,g_north_west,h_0.5,w_0.5/');
}

/**
 * Promotion fast path: server-side copy of an existing (already validated)
 * book sheet into the avatar's own Cloudinary folder.
 */
export async function copySheetIntoAvatarFolder(
  avatarId: string,
  artStyle: string,
  sourceSheetUrl: string,
): Promise<string> {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  const folder = avatarGeneratedFolderPrefix(avatarId).replace(/\/$/, '');
  const result = await cloudinary.uploader.upload(sourceSheetUrl, {
    folder,
    public_id: `sheet_${artStyle}`,
    overwrite: true,
    invalidate: true,
    resource_type: 'image',
    tags: ['avatar-sheet', avatarId, artStyle],
  });
  if (!result?.secure_url) throw new Error('Sheet copy returned no URL');
  return result.secure_url;
}

/** Generate → upload → validate, up to two rounds. Throws on total failure. */
export async function generateAvatarSheet(
  params: GenerateAvatarSheetParams,
): Promise<AvatarSheetResult> {
  const { openai, avatarId, artStyle, subject, sourceUrls, logger } = params;
  if (!isValidStyle(artStyle)) throw new Error(`Unknown art style: ${artStyle}`);
  if (sourceUrls.length === 0) throw new Error('No source images for avatar sheet');

  const provider = getGemini();
  const photos = await Promise.all(
    sourceUrls
      .slice(0, MAX_SOURCE_PHOTOS)
      .map((url) => fetchImageInput(optimizeCloudinaryUrlForVision(url))),
  );
  const styleExemplarUrls = STYLE_LIBRARY[artStyle].referenceImageUrls.slice(
    0,
    STYLE_EXEMPLARS_FOR_SHEET,
  );
  const styleRefs = await Promise.all(styleExemplarUrls.map((url) => fetchImageInput(url)));

  const prompt = createCharacterSheetPrompt({
    character: subject,
    photoCount: photos.length,
    styleRefCount: styleRefs.length,
    styleBible: getStyleBible(artStyle),
  });

  let lastError = 'sheet generation failed';
  for (let round = 1; round <= MAX_GENERATION_ROUNDS; round++) {
    const output = await provider.generate({
      contentImage: photos[0],
      characterRefs: photos.slice(1),
      styleRefs,
      prompt,
    });
    if (!output.imageBase64) {
      lastError = output.blockedReason
        ? `blocked: ${output.blockedReason}`
        : 'provider returned no image';
      logger.warn({ avatarId, artStyle, round, lastError }, 'Avatar sheet round failed');
      continue;
    }

    const sheetUrl = await uploadAvatarSheet(
      avatarId,
      artStyle,
      Buffer.from(output.imageBase64, 'base64'),
    );
    const verdict = await validateAvatarSheet({
      openai,
      subject,
      sheetUrl,
      sourceUrls: sourceUrls.slice(0, MAX_SOURCE_PHOTOS),
      styleExemplarUrls,
      artStyle,
      logger,
    });
    if (verdict.passed) {
      return {
        turnaroundSheetUrl: sheetUrl,
        portraitUrl: portraitUrlFromSheet(sheetUrl),
        provider: provider.name,
        model: provider.modelId,
        validated: true,
      };
    }
    lastError = 'sheet failed validation';
    logger.warn(
      {
        avatarId,
        artStyle,
        round,
        failedAxes: verdict.failedAxes,
        notes: verdict.notes.slice(0, 300),
      },
      'Avatar sheet failed validation',
    );
  }
  throw new Error(lastError);
}

async function uploadAvatarSheet(
  avatarId: string,
  artStyle: string,
  buffer: Buffer,
): Promise<string> {
  return uploadAvatarImage(avatarId, `sheet_${artStyle}`, buffer, [
    'avatar-sheet',
    avatarId,
    artStyle,
  ]);
}

/** Upload one generated image into the avatar's scoped Cloudinary folder. */
async function uploadAvatarImage(
  avatarId: string,
  publicId: string,
  buffer: Buffer,
  tags: string[],
  format?: string,
): Promise<string> {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  const folder = avatarGeneratedFolderPrefix(avatarId).replace(/\/$/, '');
  return new Promise<string>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
        tags,
        ...(format ? { format } : {}),
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          reject(error ?? new Error(`Avatar image upload returned no URL (${publicId})`));
        } else {
          resolve(result.secure_url);
        }
      },
    );
    stream.end(buffer);
  });
}

interface ValidateAvatarSheetParams {
  openai: OpenAI;
  subject: SheetCharacterInput;
  sheetUrl: string;
  sourceUrls: string[];
  styleExemplarUrls: string[];
  artStyle: string;
  logger: Logger;
}

/**
 * gpt-5-mini validation. Fails CLOSED when OPENAI_API_KEY is unset (matches
 * books). Returns the log-shaped verdict (pass/fail + failed axes + notes) so
 * the caller's failure log names WHY the rubric rejected the sheet.
 */
async function validateAvatarSheet(
  params: ValidateAvatarSheetParams,
): Promise<SheetValidationVerdict> {
  const { subject, sheetUrl, sourceUrls, styleExemplarUrls, artStyle, logger } = params;
  if (!process.env.OPENAI_API_KEY) {
    logger.error({}, 'OPENAI_API_KEY missing — avatar sheet validation fails closed');
    return { passed: false, failedAxes: [], notes: 'OPENAI_API_KEY not configured' };
  }
  const prompt = createSheetValidationPrompt({
    character: subject,
    photoCount: sourceUrls.length,
    styleRefCount: styleExemplarUrls.length,
    artStyle,
  });
  const response = await params.openai.responses.create({
    model: ANALYSIS_MODEL,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: SHEET_VALIDATION_SYSTEM_PROMPT }],
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          ...sourceUrls.map((url) => ({
            type: 'input_image' as const,
            image_url: optimizeCloudinaryUrlForVision(url),
            detail: 'high' as const,
          })),
          {
            type: 'input_image' as const,
            image_url: optimizeCloudinaryUrlForVision(sheetUrl),
            detail: 'high' as const,
          },
          ...styleExemplarUrls.map((url) => ({
            type: 'input_image' as const,
            image_url: url,
            detail: 'low' as const,
          })),
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'sheet_validation',
        strict: true,
        schema: SHEET_VALIDATION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
  });
  return parseSheetValidationVerdict(response.output_text);
}

// ---------------------------------------------------------------------------
// Waving cutout (X7): sheet-anchored full-body figure on pure white, then
// in-house background removal. The cutout is GARNISH — its failure never
// fails the rendition (the card falls back to the portrait crop).
// ---------------------------------------------------------------------------

export interface GenerateAvatarCutoutParams {
  openai: OpenAI;
  avatarId: string;
  artStyle: string;
  /** AvatarKind (CHILD | ADULT | PET | TOY) — picks the greeting pose. */
  kind: string;
  subject: CutoutCharacterInput;
  /** The VALIDATED turnaround sheet — the identity anchor, never raw photos. */
  sheetUrl: string;
  /**
   * Appended to both cutout public_ids. The cutoutOnly backfill passes a
   * per-job suffix so a concurrent draw-again (which owns the bare
   * `cutout_<style>` ids) can never have its just-persisted bytes overwritten
   * by a slower stale generation — the DB compare-and-set picks the pointer,
   * and each job's upload lives at its own id.
   */
  publicIdSuffix?: string;
  logger: Logger;
}

/**
 * One generation attempt + one validation, no retry loop (plan decision 3).
 * Stores BOTH variants in the avatar folder: `cutout_<style>` (white, always)
 * and `cutout_<style>_t` (transparent PNG, when the matte succeeds). Returns
 * the URL to persist as cutoutUrl — transparent preferred, white as the
 * fallback — or null on any failure. Never throws.
 */
export async function generateAvatarCutout(
  params: GenerateAvatarCutoutParams,
): Promise<string | null> {
  const { openai, avatarId, artStyle, kind, subject, sheetUrl, logger } = params;
  const suffix = params.publicIdSuffix ?? '';
  try {
    if (!isValidStyle(artStyle)) throw new Error(`Unknown art style: ${artStyle}`);

    const sheet = await fetchImageInput(optimizeCloudinaryUrlForVision(sheetUrl));
    const styleExemplarUrls = STYLE_LIBRARY[artStyle].referenceImageUrls.slice(
      0,
      STYLE_EXEMPLARS_FOR_SHEET,
    );
    const styleRefs = await Promise.all(styleExemplarUrls.map((url) => fetchImageInput(url)));

    const prompt = createCharacterCutoutPrompt({
      character: subject,
      kind,
      styleRefCount: styleRefs.length,
      styleBible: getStyleBible(artStyle),
    });
    const output = await getGemini().generate({ contentImage: sheet, styleRefs, prompt });
    if (!output.imageBase64) {
      logger.warn(
        { avatarId, artStyle, blockedReason: output.blockedReason },
        'Avatar cutout generation returned no image',
      );
      return null;
    }

    const whiteBuffer = Buffer.from(output.imageBase64, 'base64');
    const whiteUrl = await uploadAvatarImage(avatarId, `cutout_${artStyle}${suffix}`, whiteBuffer, [
      'avatar-cutout',
      avatarId,
      artStyle,
    ]);

    const validated = await validateAvatarCutout({
      openai,
      subject,
      kind,
      sheetUrl,
      candidateUrl: whiteUrl,
      styleExemplarUrls,
      artStyle,
      logger,
    });
    if (!validated) {
      logger.warn({ avatarId, artStyle }, 'Avatar cutout failed validation — keeping portrait');
      return null;
    }

    // In-house background removal (owner decision: no Cloudinary add-on).
    // A degenerate matte keeps the white original — on the white shelf card
    // that still reads as a cutout.
    try {
      const { data, info } = await sharp(whiteBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const matte = matteWhiteBackground(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        info.width,
        info.height,
      );
      if (isUsableMatte(matte)) {
        const png = await sharp(data, {
          raw: { width: info.width, height: info.height, channels: 4 },
        })
          .png()
          .toBuffer();
        const transparentUrl = await uploadAvatarImage(
          avatarId,
          `cutout_${artStyle}${suffix}_t`,
          png,
          ['avatar-cutout', avatarId, artStyle],
          'png',
        );
        logger.info({ avatarId, artStyle, ...matte }, 'Avatar cutout READY (transparent)');
        return transparentUrl;
      }
      logger.warn(
        { avatarId, artStyle, ...matte },
        'Cutout matte degenerate — keeping the white variant',
      );
    } catch (matteError) {
      logger.warn(
        { avatarId, artStyle, error: String(matteError) },
        'Cutout background removal failed — keeping the white variant',
      );
    }
    return whiteUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ avatarId, artStyle, error: message }, 'Avatar cutout failed — card falls back');
    return null;
  }
}

/**
 * Best-effort removal of BOTH cutout variants behind one stored URL — used
 * when a guarded cutoutUrl write loses to a concurrent redraw, so the loser's
 * suffixed uploads don't linger as orphans (the avatar folder purge on
 * deletion remains the backstop). Never throws.
 */
export async function destroyCutoutVariants(url: string, logger: Logger): Promise<void> {
  try {
    const publicId = extractCloudinaryPublicId(url);
    if (!publicId) return;
    const sibling = publicId.endsWith('_t') ? publicId.slice(0, -2) : `${publicId}_t`;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    await cloudinary.api.delete_resources([publicId, sibling], {
      resource_type: 'image',
      type: 'upload',
      invalidate: true,
    });
  } catch (error) {
    logger.warn({ url, error: String(error) }, 'Cutout loser cleanup skipped (non-fatal)');
  }
}

interface ValidateAvatarCutoutParams {
  openai: OpenAI;
  subject: CutoutCharacterInput;
  kind: string;
  sheetUrl: string;
  candidateUrl: string;
  styleExemplarUrls: string[];
  artStyle: string;
  logger: Logger;
}

/** gpt-5-mini pass/fail sanity check. Fails CLOSED when OPENAI_API_KEY is unset. */
async function validateAvatarCutout(params: ValidateAvatarCutoutParams): Promise<boolean> {
  const { openai, subject, kind, sheetUrl, candidateUrl, styleExemplarUrls, artStyle, logger } =
    params;
  if (!process.env.OPENAI_API_KEY) {
    logger.error({}, 'OPENAI_API_KEY missing — avatar cutout validation fails closed');
    return false;
  }
  const prompt = createCutoutValidationPrompt({
    character: subject,
    kind,
    styleRefCount: styleExemplarUrls.length,
    artStyle,
  });
  const response = await openai.responses.create({
    model: ANALYSIS_MODEL,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: CUTOUT_VALIDATION_SYSTEM_PROMPT }],
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          {
            type: 'input_image' as const,
            image_url: optimizeCloudinaryUrlForVision(sheetUrl),
            detail: 'high' as const,
          },
          {
            type: 'input_image' as const,
            image_url: optimizeCloudinaryUrlForVision(candidateUrl),
            detail: 'high' as const,
          },
          ...styleExemplarUrls.map((url) => ({
            type: 'input_image' as const,
            image_url: url,
            detail: 'low' as const,
          })),
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'cutout_validation',
        strict: true,
        schema: CUTOUT_VALIDATION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
  });
  try {
    const verdict = JSON.parse(response.output_text) as { passed?: boolean };
    return verdict.passed === true;
  } catch {
    return false;
  }
}
