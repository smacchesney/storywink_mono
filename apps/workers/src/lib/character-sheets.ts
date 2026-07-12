/**
 * Character turnaround sheets (CHARACTER_SHEETS_ENABLED).
 *
 * At character-extraction time we generate ONE validated 2x2 turnaround grid
 * per main character (max 2 per book) in the book's art style, store it in
 * Book.characterReferences keyed by (characterId, artStyle), and pass it as a
 * role-labeled image reference into every page and cover render plus the QC
 * pass. Identity then travels as pixels — the channel the image model
 * actually conditions on — instead of prose alone.
 *
 * Pure selection/keying logic lives in character-sheets.helpers.ts (unit
 * tested without infrastructure); this module owns generation, validation,
 * upload, and persistence.
 */

import { v2 as cloudinary } from 'cloudinary';
import OpenAI from 'openai';
import type { Logger } from 'pino';
import prisma from '../database/index.js';
import {
  CharacterDescription,
  CharacterIdentity,
  CharacterReferenceEntry,
  CharacterSheetRef,
  trackEvent,
} from '@storywink/shared';
import {
  createCharacterSheetPrompt,
  createSheetValidationPrompt,
  SHEET_VALIDATION_SYSTEM_PROMPT,
  SHEET_VALIDATION_RESPONSE_SCHEMA,
} from '@storywink/shared/prompts/character-identity';
import {
  getStyleBible,
  isValidStyle,
  STYLE_LIBRARY,
  StyleKey,
} from '@storywink/shared/prompts/styles';
import { optimizeCloudinaryUrlForVision } from '@storywink/shared/utils';
import { getIllustrator } from './illustrators/index.js';
import type { IllustrationImageInput } from './illustrators/index.js';
import { fetchImageInput } from './images.js';
import { ANALYSIS_MODEL } from '../config/models.js';
import {
  MAX_SHEET_GENERATIONS_PER_BOOK,
  SHEET_BUDGET_MS,
  STYLE_EXEMPLARS_FOR_SHEET,
  characterSheetsEnabled,
  parseCharacterReferences,
  resolveCharacterPhotoUrls,
  selectSheetCharacters,
  upsertCharacterReference,
  type PageWithAsset,
} from './character-sheets.helpers.js';

export * from './character-sheets.helpers.js';

export interface EnsureCharacterSheetsParams {
  bookId: string;
  userId: string;
  artStyle: string;
  identity: CharacterIdentity | null;
  pages: PageWithAsset[];
  /** Raw Book.characterReferences Json value. */
  existingReferences: unknown;
  logger: Logger;
}

interface SheetGenerationOutcome {
  entry: CharacterReferenceEntry | null;
  attempts: number;
}

/**
 * Ensures validated character sheets exist for this book + art style.
 * Returns the refs to snapshot into illustration job data. NEVER throws and
 * never blocks the illustration flow: any failure (or the 60s wall-clock
 * budget) degrades to proceeding sheetless, mirroring how a failed identity
 * extraction already degrades.
 */
export async function ensureCharacterSheets(
  params: EnsureCharacterSheetsParams,
): Promise<CharacterSheetRef[]> {
  const { bookId, userId, artStyle, identity, pages, existingReferences, logger } = params;

  if (!characterSheetsEnabled()) return [];

  try {
    if (!identity?.characters?.length) {
      await trackEvent(
        prisma,
        { name: 'sheet_skipped', userId, bookId, props: { reason: 'no_character_identity' } },
        logger,
      );
      return [];
    }

    if (!isValidStyle(artStyle)) {
      await trackEvent(
        prisma,
        { name: 'sheet_skipped', userId, bookId, props: { reason: 'invalid_art_style', artStyle } },
        logger,
      );
      return [];
    }

    const entries = parseCharacterReferences(existingReferences);
    const selected = selectSheetCharacters(identity.characters);

    if (selected.length === 0) {
      await trackEvent(
        prisma,
        { name: 'sheet_skipped', userId, bookId, props: { reason: 'no_eligible_characters' } },
        logger,
      );
      return [];
    }

    // Reuse: existence check keyed by (characterId, artStyle).
    const reused: CharacterSheetRef[] = [];
    const toGenerate: CharacterDescription[] = [];
    for (const character of selected) {
      const existing = entries.find(
        (e) => e.characterId === character.characterId && e.artStyle === artStyle,
      );
      if (existing) {
        reused.push({
          characterId: character.characterId,
          name: character.name,
          url: existing.url,
        });
      } else {
        toGenerate.push(character);
      }
    }

    if (toGenerate.length === 0) {
      logger.info(
        { bookId, artStyle, sheetCount: reused.length },
        'Reusing existing character sheets for this art style',
      );
      return reused;
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    const deadline = Date.now() + SHEET_BUDGET_MS;
    // Shared across characters; incremented synchronously before each await,
    // so the parallel tasks respect the book-wide hard cap.
    const attemptBudget = { used: 0 };

    // Same 2 style exemplars the pages use — a prose-only sheet drifts
    // off-style and then WINS the arbitration fight on every page.
    const styleExemplarUrls = STYLE_LIBRARY[artStyle].referenceImageUrls.slice(
      0,
      STYLE_EXEMPLARS_FOR_SHEET,
    );
    const styleExemplars = await Promise.all(styleExemplarUrls.map(fetchImageInput));

    // Per-character generations run in parallel.
    const generationRun = Promise.all(
      toGenerate.map((character) =>
        generateAndValidateSheet({
          bookId,
          artStyle,
          character,
          pages,
          styleExemplars,
          styleExemplarUrls: [...styleExemplarUrls],
          deadline,
          attemptBudget,
          logger,
        }),
      ),
    ).then(async (outcomes: SheetGenerationOutcome[]) => {
      const newEntries = outcomes
        .map((o) => o.entry)
        .filter((e): e is CharacterReferenceEntry => Boolean(e));
      const totalAttempts = outcomes.reduce((sum, o) => sum + o.attempts, 0);

      if (newEntries.length > 0) {
        await persistCharacterReferences(bookId, newEntries, logger);
      }
      await trackEvent(
        prisma,
        {
          name: 'sheet_generated',
          userId,
          bookId,
          props: {
            characters: toGenerate.map((c) => c.characterId),
            attempts: totalAttempts,
            validated: newEntries.length,
          },
        },
        logger,
      );
      return newEntries;
    });

    // HARD 60s wall-clock budget for the whole step: when it expires we
    // proceed sheetless (hadSheet=false for this run). The in-flight run
    // keeps going in the background and persists late results, so the NEXT
    // run (or a re-illustrate) reuses them for free.
    let budgetTimer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<'BUDGET_EXCEEDED'>((resolve) => {
      budgetTimer = setTimeout(() => resolve('BUDGET_EXCEEDED'), SHEET_BUDGET_MS);
    });

    const raced = await Promise.race([generationRun, budget]).finally(() => {
      clearTimeout(budgetTimer);
    });

    if (raced === 'BUDGET_EXCEEDED') {
      logger.warn(
        { bookId, artStyle, budgetMs: SHEET_BUDGET_MS },
        'Character sheet budget exceeded — proceeding sheetless (late results persist for reuse)',
      );
      generationRun.catch((error) =>
        logger.warn(
          { bookId, error: error instanceof Error ? error.message : 'Unknown error' },
          'Background character sheet generation failed after budget expiry',
        ),
      );
      await trackEvent(
        prisma,
        { name: 'sheet_skipped', userId, bookId, props: { reason: 'budget_exceeded' } },
        logger,
      );
      return reused;
    }

    const generatedRefs: CharacterSheetRef[] = raced.map((entry) => ({
      characterId: entry.characterId,
      name: identity.characters.find((c) => c.characterId === entry.characterId)?.name ?? null,
      url: entry.url,
    }));

    return [...reused, ...generatedRefs];
  } catch (error) {
    // Sheet problems must never block the illustration flow.
    logger.error(
      { bookId, error: error instanceof Error ? error.message : 'Unknown error' },
      'ensureCharacterSheets failed — proceeding without character sheets',
    );
    await trackEvent(
      prisma,
      { name: 'sheet_skipped', userId, bookId, props: { reason: 'error' } },
      logger,
    );
    return [];
  }
}

interface GenerateSheetParams {
  bookId: string;
  artStyle: StyleKey;
  character: CharacterDescription;
  pages: PageWithAsset[];
  styleExemplars: IllustrationImageInput[];
  styleExemplarUrls: string[];
  deadline: number;
  attemptBudget: { used: number };
  logger: Logger;
}

/**
 * Generates + validates one character's sheet: at most 2 generations
 * (regenerate once on validation failure), each drawing from the book-wide
 * attempt budget and the wall-clock deadline.
 */
async function generateAndValidateSheet(
  params: GenerateSheetParams,
): Promise<SheetGenerationOutcome> {
  const {
    bookId,
    artStyle,
    character,
    pages,
    styleExemplars,
    styleExemplarUrls,
    deadline,
    attemptBudget,
    logger,
  } = params;

  let attempts = 0;

  try {
    const photoUrls = resolveCharacterPhotoUrls(character, pages);
    if (photoUrls.length === 0) return { entry: null, attempts };
    const photos = await Promise.all(photoUrls.map(fetchImageInput));

    const prompt = createCharacterSheetPrompt({
      character,
      photoCount: photos.length,
      styleRefCount: styleExemplars.length,
      styleBible: getStyleBible(artStyle),
    });

    // First generation + at most one regeneration on validation failure.
    for (let round = 0; round < 2; round++) {
      if (Date.now() >= deadline) {
        logger.warn(
          { bookId, characterId: character.characterId },
          'Sheet deadline reached — stopping',
        );
        return { entry: null, attempts };
      }
      if (attemptBudget.used >= MAX_SHEET_GENERATIONS_PER_BOOK) {
        logger.warn(
          { bookId, characterId: character.characterId },
          'Book-wide sheet generation cap reached',
        );
        return { entry: null, attempts };
      }
      attemptBudget.used += 1;
      attempts += 1;

      const illustrator = getIllustrator();
      const result = await illustrator.generate({
        contentImage: photos[0],
        characterRefs: photos.slice(1),
        styleRefs: styleExemplars,
        prompt,
      });

      if (!result.imageBase64) {
        logger.warn(
          { bookId, characterId: character.characterId, reason: result.blockedReason },
          'Character sheet generation returned no image',
        );
        continue;
      }

      // Upload first (overwrite per (characterId, artStyle)), then validate
      // by URL. A failed attempt stays in Cloudinary for offline inspection
      // but is never recorded in Book.characterReferences.
      const sheetUrl = await uploadSheet(
        bookId,
        character.characterId,
        artStyle,
        Buffer.from(result.imageBase64, 'base64'),
      );

      const validation = await validateSheet({
        character,
        artStyle,
        photoUrls,
        sheetUrl,
        styleExemplarUrls,
      });

      if (validation.passed) {
        logger.info(
          { bookId, characterId: character.characterId, artStyle, attempts },
          'Character sheet generated and validated',
        );
        return {
          entry: {
            characterId: character.characterId,
            artStyle,
            url: sheetUrl,
            validatedAt: new Date().toISOString(),
          },
          attempts,
        };
      }

      logger.warn(
        { bookId, characterId: character.characterId, notes: validation.notes, round },
        'Character sheet failed validation',
      );
    }

    return { entry: null, attempts };
  } catch (error) {
    logger.warn(
      {
        bookId,
        characterId: character.characterId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'Character sheet generation errored — proceeding without this sheet',
    );
    return { entry: null, attempts };
  }
}

async function uploadSheet(
  bookId: string,
  characterId: string,
  artStyle: string,
  buffer: Buffer,
): Promise<string> {
  const uploadResult = await new Promise<{ secure_url?: string }>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: `storywink/${bookId}/refs`,
          public_id: `char_${characterId}_${artStyle}`,
          overwrite: true,
          tags: [
            `book:${bookId}`,
            `character:${characterId}`,
            `style:${artStyle}`,
            'character-sheet',
          ],
          resource_type: 'image',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result ?? {});
        },
      )
      .end(buffer);
  });

  if (!uploadResult.secure_url) {
    throw new Error('Cloudinary sheet upload did not return a secure URL.');
  }
  return uploadResult.secure_url;
}

interface ValidateSheetParams {
  character: CharacterDescription;
  artStyle: string;
  photoUrls: string[];
  sheetUrl: string;
  styleExemplarUrls: string[];
}

async function validateSheet(
  params: ValidateSheetParams,
): Promise<{ passed: boolean; notes: string }> {
  const { character, artStyle, photoUrls, sheetUrl, styleExemplarUrls } = params;

  if (!process.env.OPENAI_API_KEY) {
    // No validator available: fail closed. An unvalidated sheet that drifted
    // would poison every page, which is worse than no sheet.
    return { passed: false, notes: 'OPENAI_API_KEY not configured — cannot validate sheet' };
  }

  const promptText = createSheetValidationPrompt({
    character,
    photoCount: photoUrls.length,
    styleRefCount: styleExemplarUrls.length,
    artStyle,
  });

  const contentParts: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string; detail: 'high' }
  > = [
    ...photoUrls.map((url) => ({
      type: 'input_image' as const,
      image_url: url,
      detail: 'high' as const,
    })),
    { type: 'input_image', image_url: optimizeCloudinaryUrlForVision(sheetUrl), detail: 'high' },
    ...styleExemplarUrls.map((url) => ({
      type: 'input_image' as const,
      image_url: url,
      detail: 'high' as const,
    })),
    { type: 'input_text', text: promptText },
  ];

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await openai.responses.create({
    model: ANALYSIS_MODEL,
    instructions: SHEET_VALIDATION_SYSTEM_PROMPT,
    input: [{ role: 'user', content: contentParts }],
    text: {
      format: {
        type: 'json_schema',
        name: 'sheet_validation',
        strict: true,
        schema: SHEET_VALIDATION_RESPONSE_SCHEMA as Record<string, unknown>,
      },
    },
  });

  const raw = result.output_text;
  if (!raw) return { passed: false, notes: 'Validator returned empty response' };

  const parsed = JSON.parse(raw) as { passed: boolean; notes: string };
  return { passed: Boolean(parsed.passed), notes: parsed.notes ?? '' };
}

/**
 * Single merged write per run (read-modify-write on the Json column; the
 * per-character tasks never write individually, so parallel generations
 * cannot clobber each other's entries).
 */
async function persistCharacterReferences(
  bookId: string,
  newEntries: CharacterReferenceEntry[],
  logger: Logger,
): Promise<void> {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { characterReferences: true },
  });
  let entries = parseCharacterReferences(book?.characterReferences);
  for (const entry of newEntries) {
    entries = upsertCharacterReference(entries, entry);
  }
  await prisma.book.update({
    where: { id: bookId },
    data: { characterReferences: entries as unknown as object },
  });
  logger.info(
    { bookId, newCount: newEntries.length, totalCount: entries.length },
    'Persisted character sheet references',
  );
}
