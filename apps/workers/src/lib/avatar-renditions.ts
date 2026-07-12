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
import {
  createCharacterSheetPrompt,
  createSheetValidationPrompt,
  createAvatarIdentityPrompt,
  SHEET_VALIDATION_SYSTEM_PROMPT,
  SHEET_VALIDATION_RESPONSE_SCHEMA,
  CHARACTER_IDENTITY_RESPONSE_SCHEMA,
  type SheetCharacterInput,
} from '@storywink/shared/prompts/character-identity';
import { getStyleBible, isValidStyle, STYLE_LIBRARY } from '@storywink/shared/prompts/styles';
import { optimizeCloudinaryUrlForVision } from '@storywink/shared/utils';
import { avatarGeneratedFolderPrefix } from '@storywink/shared';
import { GeminiProvider } from './illustrators/gemini.js';
import type { IllustrationProvider } from './illustrators/types.js';
import { fetchImageInput } from './images.js';
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
  character: SheetCharacterInput & { appearsOnPages?: number[] };
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
}

/** One gpt-5-mini vision call: photos of one subject → CharacterDescription. */
export async function extractAvatarIdentity(
  params: ExtractAvatarIdentityParams,
): Promise<AvatarIdentity> {
  const { openai, kind, displayName, artStyle, sourceUrls, logger } = params;
  const prompt = createAvatarIdentityPrompt({
    kind,
    displayName,
    artStyle,
    photoCount: sourceUrls.length,
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
    characters: Array<SheetCharacterInput & { appearsOnPages?: number[] }>;
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
    const validated = await validateAvatarSheet({
      openai,
      subject,
      sheetUrl,
      sourceUrls: sourceUrls.slice(0, MAX_SOURCE_PHOTOS),
      styleExemplarUrls,
      artStyle,
      logger,
    });
    if (validated) {
      return {
        turnaroundSheetUrl: sheetUrl,
        portraitUrl: portraitUrlFromSheet(sheetUrl),
        provider: provider.name,
        model: provider.modelId,
        validated: true,
      };
    }
    lastError = 'sheet failed validation';
    logger.warn({ avatarId, artStyle, round }, 'Avatar sheet failed validation');
  }
  throw new Error(lastError);
}

async function uploadAvatarSheet(
  avatarId: string,
  artStyle: string,
  buffer: Buffer,
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
        public_id: `sheet_${artStyle}`,
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
        tags: ['avatar-sheet', avatarId, artStyle],
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          reject(error ?? new Error('Avatar sheet upload returned no URL'));
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

/** gpt-5-mini pass/fail. Fails CLOSED when OPENAI_API_KEY is unset (matches books). */
async function validateAvatarSheet(params: ValidateAvatarSheetParams): Promise<boolean> {
  const { subject, sheetUrl, sourceUrls, styleExemplarUrls, artStyle, logger } = params;
  if (!process.env.OPENAI_API_KEY) {
    logger.error({}, 'OPENAI_API_KEY missing — avatar sheet validation fails closed');
    return false;
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
  try {
    const verdict = JSON.parse(response.output_text) as { passed?: boolean };
    return verdict.passed === true;
  } catch {
    return false;
  }
}
