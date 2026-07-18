import { Job } from 'bullmq';
import prisma from '../database/index.js';
import OpenAI from 'openai';
import pino from 'pino';
import {
  createPhotoAnalysisPrompt,
  PHOTO_ANALYSIS_SYSTEM_PROMPT,
  PHOTO_ANALYSIS_RESPONSE_SCHEMA,
  PhotoAnalysisInput,
  PhotoAnalysisResponse,
  scopeCaptureQuestions,
} from '@storywink/shared/prompts/photo-analysis';
import { optimizeCloudinaryUrlForVision, convertHeicToJpeg } from '@storywink/shared/utils';
import { ANALYSIS_MODEL, ANALYSIS_OPENAI_TIMEOUT_MS } from '../config/models.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export interface PhotoAnalysisJob {
  bookId: string;
  userId: string;
  /**
   * Set when the photo set changed after the first pass (add/remove on the
   * setup sheet). A refresh may OVERWRITE the machine-written eventSummary
   * and unanswered captureQuestions so the brief matches the new photo set —
   * but only while the book is still DRAFT, and never over parent answers.
   */
  refresh?: boolean;
}

/**
 * Perception pass: runs once at book creation, before any story work.
 * Writes Page.analysis (per-photo scene/action/emotion/narrativeRole),
 * Book.eventSummary + captureQuestions (the parent-facing capture surface),
 * Book.characterIdentity (so character-extraction can skip its vision call),
 * and a suggested title into Book.title when the title is still empty.
 *
 * Failure is ALWAYS non-fatal for the book: without perception the story
 * pipeline behaves exactly as it did before this pass existed.
 */
export async function processPhotoAnalysis(job: Job<PhotoAnalysisJob>) {
  const { bookId, userId, refresh } = job.data;
  logger.info(
    { bookId, userId, jobId: job.id, refresh: !!refresh },
    'Starting photo perception pass',
  );

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: {
      pages: {
        orderBy: { index: 'asc' },
        include: { asset: true },
      },
    },
  });

  if (!book) throw new Error('Book not found');

  // AVATAR_STORY (X6d): perception must never run — the roster was composed
  // from the linked avatars and eventSummary holds the parent-picked premise;
  // a perception pass would overwrite both. Guard here (the chokepoint) so
  // no enqueue path can clobber an avatar book.
  if (book.bookType === 'AVATAR_STORY') {
    logger.warn({ bookId, jobId: job.id }, 'Photo perception skipped: AVATAR_STORY book');
    return { success: true, skipped: 'avatar_story' };
  }

  if (!book.pages.length) throw new Error('Book has no pages');

  let additionalCharacters: { name: string; relationship: string }[] | null = null;
  if (book.additionalCharacters) {
    try {
      additionalCharacters = JSON.parse(book.additionalCharacters);
    } catch {
      logger.warn({ bookId }, 'Failed to parse additionalCharacters');
    }
  }

  // On a refresh, feed the prior roster back so the model reuses the SAME
  // characterId for the same real person/animal — an answered naming chip's
  // characterId link must survive a photo add/remove.
  const priorIdentity = refresh
    ? (book.characterIdentity as {
        characters?: { characterId: string; role: string; name: string | null }[];
      } | null)
    : null;

  // Positional numbering runs over PHOTO pages only (assetId != null). The
  // normal flow never sees anything else (bridges don't exist at create),
  // but a refresh on a book that has app-authored bridge rows would
  // otherwise desync every appearsOnPages / pageAnalysis position: the
  // vision call only receives imaged pages, so numbering must match exactly
  // what the model sees.
  const photoPages = book.pages.filter((p) => p.assetId != null);
  if (!photoPages.length) throw new Error('Book has no photo pages');

  const input: PhotoAnalysisInput = {
    childName: book.childName,
    additionalCharacters,
    artStyle: book.artStyle || 'vignette',
    language: book.language || 'en',
    priorCharacters: priorIdentity?.characters?.map((c) => ({
      characterId: c.characterId,
      role: c.role,
      name: c.name,
    })),
    storyPages: photoPages.map((p, i) => ({
      pageNumber: i + 1,
      assetId: p.assetId,
      imageUrl: p.asset?.url || p.asset?.thumbnailUrl || p.originalImageUrl || '',
    })),
  };

  const contentParts: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string; detail: 'high' }
  > = [];
  for (const page of input.storyPages) {
    if (page.imageUrl) {
      const url = optimizeCloudinaryUrlForVision(convertHeicToJpeg(page.imageUrl));
      contentParts.push({ type: 'input_image', image_url: url, detail: 'high' });
    }
  }
  if (contentParts.length === 0) throw new Error('No images available for analysis');
  contentParts.push({ type: 'input_text', text: createPhotoAnalysisPrompt(input) });

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: ANALYSIS_OPENAI_TIMEOUT_MS,
  });
  const result = await openai.responses.create({
    model: ANALYSIS_MODEL,
    instructions: PHOTO_ANALYSIS_SYSTEM_PROMPT,
    input: [{ role: 'user', content: contentParts }],
    text: {
      format: {
        type: 'json_schema',
        name: 'photo_analysis',
        strict: true,
        schema: PHOTO_ANALYSIS_RESPONSE_SCHEMA as Record<string, unknown>,
      },
    },
  });

  if (!result.output_text) throw new Error('Photo analysis returned empty response');
  const analysis = JSON.parse(result.output_text) as PhotoAnalysisResponse;

  // The prompt asks for scoped, naming-first questions; the guarantee is
  // enforced here deterministically: naming questions only for unnamed
  // characters recurring on 2+ photos who share a photo with the main child
  // (never background strangers), sorted first, capped at 2 of the 3 slots.
  const scopedQuestions = scopeCaptureQuestions(analysis.captureQuestions, analysis.characters);
  if (scopedQuestions.length !== analysis.captureQuestions.length) {
    logger.info(
      { bookId, before: analysis.captureQuestions.length, after: scopedQuestions.length },
      'Scoped capture questions (dropped out-of-scope naming questions)',
    );
  }
  analysis.captureQuestions = scopedQuestions;

  // Stamp each character's appearsOnPages with the assetIds behind those
  // positions. appearsOnPages is creation-order-positional and goes stale if
  // the parent reorders photos; the stamps let consumers remap to the
  // current order (remapCharacterPages in @storywink/shared).
  const assetIdByPosition = new Map<number, string | null>(
    input.storyPages.map((p) => [p.pageNumber, p.assetId]),
  );
  const stampedCharacters = analysis.characters.map((c) => ({
    ...c,
    appearsOnAssetIds: c.appearsOnPages.map((n) => assetIdByPosition.get(n) ?? null),
  }));

  // Persist per-page analysis, stamped with the page's current assetId so
  // consumers can detect staleness after a photo swap.
  await prisma.$transaction(async (tx) => {
    // Same positional convention as the vision input: photo pages only.
    for (let i = 0; i < photoPages.length; i++) {
      const page = photoPages[i];
      const pageAnalysis = analysis.pageAnalysis.find((a) => a.pageNumber === i + 1);
      if (!pageAnalysis) continue;
      await tx.page.update({
        where: { id: page.id },
        data: { analysis: { ...pageAnalysis, assetId: page.assetId } },
      });
    }

    // Never clobber a parent's edits: eventSummary only fills when empty,
    // captureQuestions only when none exist yet, title only when blank.
    // A refresh (photo set changed while still DRAFT) may additionally
    // overwrite the machine-written eventSummary and REPLACE captureQuestions
    // as long as the parent hasn't answered any of them.
    const current = await tx.book.findUnique({
      where: { id: bookId },
      select: { eventSummary: true, captureQuestions: true, title: true, status: true },
    });

    const isDraftRefresh = refresh && current?.status === 'DRAFT';
    const existingQuestions =
      (current?.captureQuestions as { answer?: string | null }[] | null) ?? [];
    const hasAnswers = existingQuestions.some((q) => q.answer && q.answer.trim());

    await tx.book.update({
      where: { id: bookId },
      data: {
        characterIdentity: {
          characters: stampedCharacters,
          sceneContext: analysis.sceneContext,
          // This pass runs at create time when artStyle is usually still null,
          // so the 'vignette' fallback gets baked into styleTranslation. The
          // stamp lets the extraction worker's reuse path detect the mismatch
          // and refresh the translations with a cheap text-only call.
          extractedForStyle: input.artStyle,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any, // Prisma Json column (same cast the extraction worker uses)
        ...(!current?.eventSummary || isDraftRefresh
          ? { eventSummary: analysis.eventSummary }
          : {}),
        ...(!current?.captureQuestions || (isDraftRefresh && !hasAnswers)
          ? { captureQuestions: analysis.captureQuestions.map((q) => ({ ...q, answer: null })) }
          : {}),
        ...(current?.title?.trim() ? {} : { title: analysis.suggestedTitle.trim().slice(0, 100) }),
      },
    });
  });

  logger.info(
    {
      bookId,
      pagesAnalyzed: analysis.pageAnalysis.length,
      characters: analysis.characters.length,
      captureQuestions: analysis.captureQuestions.length,
    },
    'Photo perception pass completed',
  );

  return { success: true, pagesAnalyzed: analysis.pageAnalysis.length };
}
