import { Job, Queue } from 'bullmq';
import prisma from '../database/index.js';
import { StoryGenerationJob } from '@storywink/shared/types';
import { QUEUE_NAMES } from '@storywink/shared/constants';
import { createBullMQConnection } from '@storywink/shared/redis';
import OpenAI from 'openai';
import pino from 'pino';
import {
  createStoryGenerationPrompt,
  StoryGenerationInput,
  STORY_GENERATION_SYSTEM_PROMPT,
  StoryResponse,
  StoryBridgePageResponse,
  STORY_RESPONSE_SCHEMA,
  STORY_RESPONSE_SCHEMA_WITH_BRIDGES,
} from '@storywink/shared/prompts/story';
import {
  createStoryQCPrompt,
  STORY_QC_SYSTEM_PROMPT,
  STORY_QC_RESPONSE_SCHEMA,
  STORY_QC_THRESHOLDS,
  StoryQCResponse,
  countRefrainEchoes,
  isChildNameCheckable,
  countChildNameEchoes,
} from '@storywink/shared/prompts/story-check';
import { optimizeCloudinaryUrlForVision, convertHeicToJpeg } from '@storywink/shared/utils';
import { trackEvent } from '@storywink/shared';
import { buildConfirmedFacts } from '../lib/storyCast.js';
import {
  bridgePagesEnabled,
  bridgeCapForPhotoCount,
  validateBridgePages,
  planPageSequence,
} from '../lib/bridge-pages.js';
import {
  mergeCastNames,
  resolveCastEntries,
  checkCastNameCoverage,
  MergedCastCharacter,
  ResolvedCastEntry,
  CastCoverageResult,
} from '../lib/resolveCast.js';
import { STORY_MODEL, ANALYSIS_MODEL } from '../config/models.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Best-effort write of Book.generationPhase — the honest-progress signal the
 * wait screen narrates from. A phase write must never fail a job.
 */
async function setGenerationPhase(bookId: string, phase: string | null): Promise<void> {
  try {
    await prisma.book.update({ where: { id: bookId }, data: { generationPhase: phase } });
  } catch (error) {
    logger.warn(
      { bookId, phase, error: error instanceof Error ? error.message : 'Unknown error' },
      'Failed to write generationPhase — continuing',
    );
  }
}

// Perception-pass output persisted on Page.analysis (all optional — the
// pipeline degrades to photos-only behavior when the analysis job failed
// or is stale).
interface StoredPageAnalysis {
  assetId?: string | null;
  setting: string;
  action: string;
  emotion: string;
  eventSignals: string[];
  narrativeRole: string;
}

// Capture questions as persisted on Book.captureQuestions (Json).
interface StoredCaptureQuestion {
  id: string;
  question: string;
  options?: string[];
  characterId?: string | null;
  answer?: string | null;
}

// Book.characterIdentity (Json) as this worker reads/writes it.
interface StoredCharacterIdentity {
  characters?: MergedCastCharacter[];
  [key: string]: unknown;
}

// Regen only happens while the total job stays inside this budget, so QC can
// never turn a working story job into a hung one.
const STORY_QC_TIME_BUDGET_MS = Number(process.env.STORY_QC_TIME_BUDGET_MS || 180_000);

let characterExtractionQueue: Queue | null = null;
function getCharacterExtractionQueue(): Queue {
  if (!characterExtractionQueue) {
    characterExtractionQueue = new Queue(QUEUE_NAMES.CHARACTER_EXTRACTION, {
      connection: createBullMQConnection(),
    });
  }
  return characterExtractionQueue;
}

/**
 * Editorial review of a generated story. Refrain recurrence is checked
 * deterministically in code; the model scores arc, rhythm, caption risk,
 * and the landing. Returns numbered corrections for the regen prompt.
 */
async function evaluateStoryQuality(
  openai: OpenAI,
  storyResponse: StoryResponse,
  input: StoryGenerationInput,
  bookId: string,
  acceptedBridges: StoryBridgePageResponse[] = [],
): Promise<{ passed: boolean; feedback: string }> {
  const problems: string[] = [];
  const sortedPages = [...storyResponse.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  // Photo-positional texts (page 1..N = storyboard photos), used where
  // positions matter (castNameCoverage's appearsOnPages windows).
  const pageTexts = sortedPages.map(p => p.text || '');

  // Reading-order texts (bridges interleaved) — the book the parent will
  // actually read. Refrain echoes and the childName counts judge this.
  const bridgesByGap = new Map(acceptedBridges.map(b => [b.afterPhotoPage, b]));
  const readingOrderTexts: string[] = [];
  sortedPages.forEach(p => {
    readingOrderTexts.push(p.text || '');
    const bridge = bridgesByGap.get(p.pageNumber);
    if (bridge) readingOrderTexts.push(bridge.text);
  });

  // QC-model input keeps PHOTO-POSITIONAL numbering (feedback like "Page 5
  // reads like a caption" must point at the storyboard page the regen model
  // sees). Bridges join as labeled entries between pages: ordinal N + 0.5
  // plus an explicit "[BRIDGE PAGE — inserted after page N]" label, so the
  // judge reads the true sequence without renumbering any photo page.
  const qcPages = [
    ...sortedPages.map(p => ({ pageNumber: p.pageNumber, text: p.text })),
    ...acceptedBridges.map(b => ({
      pageNumber: b.afterPhotoPage + 0.5,
      text: `[BRIDGE PAGE — inserted after page ${b.afterPhotoPage}, generated without a photo]\n${b.text}`,
    })),
  ].sort((a, b) => a.pageNumber - b.pageNumber);

  const refrain = storyResponse.storyArc?.refrain || '';
  const echoes = countRefrainEchoes(refrain, readingOrderTexts, input.language);
  if (echoes < STORY_QC_THRESHOLDS.minRefrainEchoes) {
    problems.push(
      `The refrain "${refrain}" is only recognizable on ${echoes} page(s). It must echo (with variation) on at least ${STORY_QC_THRESHOLDS.minRefrainEchoes} pages.`,
    );
  }

  const result = await openai.responses.create({
    model: ANALYSIS_MODEL,
    instructions: STORY_QC_SYSTEM_PROMPT,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: createStoryQCPrompt({
              storyArc: storyResponse.storyArc,
              pages: qcPages,
              language: input.language,
              theme: input.theme,
              eventSummary: input.eventSummary,
              confirmedFacts: input.confirmedFacts,
            }),
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'story_qc',
        strict: true,
        schema: STORY_QC_RESPONSE_SCHEMA as Record<string, unknown>,
      },
    },
  });

  if (!result.output_text) throw new Error('Story QC returned empty response');
  const qc = JSON.parse(result.output_text) as StoryQCResponse;

  // LOG-ONLY personalization checks: scored and logged for tuning against
  // Railway data, but they never push into `problems` — every enforcing
  // check converts into a silent extra generation during the parent's wait.
  // The childName check is script-gated: kanji or cross-script names can
  // never pass a raw substring check, so they log 'skipped'.
  const childName = input.childName?.trim();
  let childNameCheck: 'checked' | 'skipped' | 'absent' = 'absent';
  let childNameEchoes: number | null = null;
  let childNameInLanding: boolean | null = null;
  if (childName) {
    if (isChildNameCheckable(childName, input.language || 'en')) {
      const nameEchoes = countChildNameEchoes(childName, readingOrderTexts);
      childNameCheck = 'checked';
      childNameEchoes = nameEchoes.pagesWithName;
      childNameInLanding = nameEchoes.nameInLanding;
    } else {
      childNameCheck = 'skipped';
    }
  }

  // LOG-ONLY castNameCoverage: does every parent-confirmed name (namedVia
  // chip/childName only) land within ±1 page of an appearance? Script-gated
  // like the childName check. Feeds the log line, never `problems`.
  const cast = (input.charactersInPhotos ?? []) as ResolvedCastEntry[];
  const castCoverage: CastCoverageResult | null = cast.length
    ? checkCastNameCoverage(cast, pageTexts, input.language || 'en')
    : null;

  logger.info(
    {
      bookId,
      refrainEchoes: echoes,
      arcCoherence: qc.arcCoherence,
      readAloudRhythm: qc.readAloudRhythm,
      lastPageLanding: qc.lastPageLanding,
      maxCaptionRisk: Math.max(0, ...qc.pages.map(p => p.captionRisk)),
      childNameCheck,
      childNameEchoes,
      childNameInLanding,
      castNamesChecked: castCoverage?.checked ?? 0,
      castNamesCovered: castCoverage?.covered ?? 0,
      castNamesMissing: castCoverage?.missing ?? [],
      castNamesSkippedScript: castCoverage?.skippedScript ?? 0,
      truthToEvent: qc.truthToEvent,
      hadEventSummary: !!input.eventSummary,
      confirmedFactCount: input.confirmedFacts?.length ?? 0,
    },
    'Story QC scores',
  );

  if (qc.arcCoherence < STORY_QC_THRESHOLDS.minArcCoherence) {
    problems.push(`Arc coherence scored ${qc.arcCoherence}/10 — the pages must actually deliver the declared desire → escalation → peak → soft landing.`);
  }
  if (qc.readAloudRhythm < STORY_QC_THRESHOLDS.minReadAloudRhythm) {
    problems.push(`Read-aloud rhythm scored ${qc.readAloudRhythm}/10 — vary sentence lengths and make it musical when spoken.`);
  }
  if (!qc.lastPageLanding) {
    problems.push('The final page must land as a soft, warm exhale — no summary statements.');
  }
  for (const page of qc.pages) {
    if (page.captionRisk > STORY_QC_THRESHOLDS.maxCaptionRisk) {
      problems.push(`Page ${page.pageNumber} reads like a photo caption (risk ${page.captionRisk}/10). ${page.issue || 'Rewrite from the child\'s inner experience.'}`);
    }
  }
  if (problems.length > 0 && qc.feedback) {
    problems.push(qc.feedback);
  }

  return {
    passed: problems.length === 0,
    feedback: problems.map((p, i) => `${i + 1}. ${p}`).join('\n'),
  };
}

export async function processStoryGeneration(job: Job<StoryGenerationJob & { singlePageId?: string; titleWasGenerated?: boolean }>) {
  // Wrap everything in try-catch to catch early errors
  try {
    // Early validation
    if (!job) {
      throw new Error('Job is undefined');
    }

    if (!job.data) {
      throw new Error('Job data is undefined');
    }

    // Validate OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Safe access to job data
    const bookId = job.data.bookId;
    const userId = job.data.userId;
    const singlePageId = job.data.singlePageId;

    // Route to single-page handler if singlePageId is present
    if (singlePageId) {
      return await processSinglePageTextGeneration(job, openai, bookId, singlePageId);
    }

    if (!bookId || !userId) {
      throw new Error(`Missing required job data: bookId=${bookId}, userId=${userId}`);
    }

    // Update status to generating (phase rides the same write — it can only
    // fail if the status write fails, which already fails the job)
    await prisma.book.update({
      where: { id: bookId },
      data: { status: 'GENERATING', generationPhase: 'story' },
    });

    // Get book with pages (excluding cover page)
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        pages: {
          orderBy: { index: 'asc' }, // Use user-defined order, not pageNumber
          include: { asset: true },
        },
      },
    });

    if (!book) {
      throw new Error('Book not found');
    }

    // PURGE-AT-START (bridge pages): BRIDGE rows are app-authored derivatives
    // of a PREVIOUS story, so a fresh generation must never inherit them —
    // this makes BullMQ retries idempotent and re-generation from COMPLETED
    // clean. Data-driven rather than flag-gated: stale rows left behind by a
    // flag rollback must not survive a regen either. Runs BEFORE the
    // pageLength comparison below so the mismatch warn can't fire spuriously,
    // and pageLength is recomputed in the same transaction.
    if (book.pages.some(p => p.source === 'BRIDGE')) {
      const survivors = book.pages.filter(p => p.source !== 'BRIDGE');
      await prisma.$transaction(async (tx) => {
        await tx.page.deleteMany({ where: { bookId, source: 'BRIDGE' } });
        for (let i = 0; i < survivors.length; i++) {
          await tx.page.update({
            where: { id: survivors[i].id },
            data: { index: i, pageNumber: i + 1 },
          });
        }
        await tx.book.update({ where: { id: bookId }, data: { pageLength: survivors.length } });
      });
      logger.info(
        { bookId, purgedBridges: book.pages.length - survivors.length, remainingPages: survivors.length },
        'Purged stale bridge pages before story generation',
      );
      book.pages = survivors.map((p, i) => ({ ...p, index: i, pageNumber: i + 1 }));
      book.pageLength = survivors.length;
    }

    // All pages participate in story generation (including cover page)
    const storyPages = book.pages;

    if (!storyPages || storyPages.length === 0) {
      throw new Error('Book has no pages');
    }

    // Diagnostic logging for debugging text assignment issues
    logger.info({
      bookId,
      totalPages: book.pages.length,
      coverAssetId: book.coverAssetId,
      storyPagesCount: storyPages.length,
      expectedPageLength: book.pageLength,
      actualPageLength: book.pages.length,
      storyPageDetails: storyPages.map(p => ({
        id: p.id,
        index: p.index,
        pageNumber: p.pageNumber,
        assetId: p.assetId,
        hasExistingText: !!p.text
      }))
    }, 'Story generation page analysis');

    // Validate page count
    if (storyPages.length !== book.pageLength) {
      logger.warn({
        bookId,
        storyPagesCount: storyPages.length,
        expectedStoryPages: book.pageLength,
        bookPageLength: book.pageLength,
        totalPagesInBook: book.pages.length
      }, 'Page count mismatch - story pages vs expected');
    }

    // Parse additional characters from JSON string (if present)
    let additionalCharacters: { name: string; relationship: string }[] = [];
    if (book.additionalCharacters) {
      try {
        additionalCharacters = JSON.parse(book.additionalCharacters);
      } catch (e) {
        logger.warn({ bookId, error: e }, 'Failed to parse additionalCharacters');
      }
    }

    // Perception-pass context (all optional — the pipeline degrades to
    // photos-only behavior when the analysis job failed or is stale).
    const captureQuestions = (book.captureQuestions as StoredCaptureQuestion[] | null) ?? [];

    // resolveCast: merge the parent's naming signal (chip answers + the
    // sheet's childName) into the roster and PERSIST it BEFORE
    // character-extraction reads it — the extraction worker's reuse path then
    // carries the confirmed names into every illustration prompt for free.
    // Perception refreshes are DRAFT-gated, so the persisted merge is durable
    // once the book leaves DRAFT (character-extraction re-applies the same
    // merge to close the in-flight-refresh race).
    const rawIdentity = book.characterIdentity as StoredCharacterIdentity | null;
    let mergedCharacters: MergedCastCharacter[] = rawIdentity?.characters ?? [];
    let consumedQuestionIds = new Set<string>();
    if (mergedCharacters.length > 0) {
      const merge = mergeCastNames({
        characters: mergedCharacters,
        captureQuestions,
        childName: book.childName,
      });
      mergedCharacters = merge.characters;
      consumedQuestionIds = new Set(merge.consumedQuestionIds);
      if (merge.changed) {
        try {
          await prisma.book.update({
            where: { id: bookId },
            data: {
              characterIdentity: {
                ...rawIdentity,
                characters: mergedCharacters,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any, // Prisma Json column (same cast the extraction worker uses)
            },
          });
          logger.info(
            {
              bookId,
              namedCharacters: mergedCharacters.filter(c => c.name).length,
              consumedAnswers: merge.consumedQuestionIds.length,
            },
            'resolveCast: merged capture answers + childName into character identity',
          );
        } catch (mergeError) {
          // Persist failure is cosmetic for THIS story run (the in-memory
          // merge still feeds the prompt); illustration falls back to the
          // unnamed roster.
          logger.warn(
            { bookId, error: mergeError instanceof Error ? mergeError.message : 'Unknown error' },
            'resolveCast persist failed — continuing with in-memory merged cast',
          );
        }
      }
    }

    // A chip answer leaves confirmedFacts ONLY when the merge actually
    // consumed it (its information now arrives structured through the cast).
    // A failed join keeps the answer as a fact line — the parent's tap must
    // never be silently dropped.
    const confirmedFacts = buildConfirmedFacts(
      captureQuestions.filter(q => !consumedQuestionIds.has(q.id)),
    );

    // appearsOnPages is creation-order-positional; remap per character to the
    // CURRENT page order via the perception pass's assetId stamps. Characters
    // whose photos were all removed are dropped (never reintroduce removed
    // people); partially-resolvable characters stay in the cast page-less
    // rather than asserting wrong page numbers.
    const charactersInPhotos = mergedCharacters.length
      ? resolveCastEntries(mergedCharacters, storyPages.map(p => p.assetId))
      : [];

    // BRIDGE_PAGES_ENABLED: request bridges only when the flag is on AND a
    // grounded roster exists (identity-less books get no bridges — there is
    // nothing to validate charactersPresent against). Cap is code-enforced
    // again at validation time.
    const bridgeCap =
      bridgePagesEnabled() && charactersInPhotos.length > 0
        ? bridgeCapForPhotoCount(storyPages.length)
        : 0;

    // Prepare story generation input using advanced prompt structure
    const storyInput: StoryGenerationInput = {
      bookTitle: book.title || 'My Special Story',
      isDoubleSpread: false, // Could be added to book settings in future
      artStyle: book.artStyle || undefined,
      childName: book.childName || undefined,
      additionalCharacters: additionalCharacters.length > 0 ? additionalCharacters : undefined,
      tone: book.tone || undefined,
      theme: book.theme || undefined,
      eventSummary: book.eventSummary || undefined,
      confirmedFacts: confirmedFacts.length > 0 ? confirmedFacts : undefined,
      charactersInPhotos: charactersInPhotos.length > 0 ? charactersInPhotos : undefined,
      bridgeCap: bridgeCap > 0 ? bridgeCap : undefined,
      language: book.language || 'en',
      suggestTitle: job.data.titleWasGenerated === true,
      storyPages: storyPages.map((page, index) => {
        const analysis = page.analysis as StoredPageAnalysis | null;
        // Stale analysis (photo was swapped since the perception pass) is dropped.
        const fresh = analysis && analysis.assetId === page.assetId ? analysis : null;
        return {
          pageId: page.id,
          pageNumber: index + 1, // 1-based numbering for story pages
          assetId: page.assetId,
          originalImageUrl: page.asset?.url || page.asset?.thumbnailUrl || null,
          analysis: fresh
            ? {
                setting: fresh.setting,
                action: fresh.action,
                emotion: fresh.emotion,
                eventSignals: fresh.eventSignals || [],
                narrativeRole: fresh.narrativeRole,
              }
            : null,
        };
      }),
    };

    const jobStartedAt = Date.now();

    // Generate the story (optionally with editorial corrections from a failed QC round)
    const generateStory = async (qcFeedback?: string): Promise<StoryResponse> => {
      const promptParts = createStoryGenerationPrompt({ ...storyInput, qcFeedback });
      const contentParts: Array<
        | { type: 'input_text'; text: string }
        | { type: 'input_image'; image_url: string; detail: 'high' }
      > = [];

      for (const part of promptParts) {
        if ('type' in part && part.type === 'image_placeholder') {
          const url = optimizeCloudinaryUrlForVision(convertHeicToJpeg(part.imageUrl));
          contentParts.push({ type: 'input_image', image_url: url, detail: 'high' });
        } else if ('text' in part) {
          contentParts.push({ type: 'input_text', text: part.text });
        }
      }

      const result = await openai.responses.create({
        model: STORY_MODEL,
        instructions: STORY_GENERATION_SYSTEM_PROMPT,
        input: [{ role: 'user', content: contentParts }],
        text: {
          format: {
            type: 'json_schema',
            name: 'story_response',
            strict: true,
            // The bridge-enabled schema is requested ONLY when the prompt
            // carries the bridge section; flag-off requests are byte-identical
            // to the legacy schema.
            schema: (bridgeCap > 0
              ? STORY_RESPONSE_SCHEMA_WITH_BRIDGES
              : STORY_RESPONSE_SCHEMA) as unknown as Record<string, unknown>,
          },
        },
      });

      const rawResult = result.output_text;
      if (!rawResult) {
        throw new Error('OpenAI returned empty response');
      }

      logger.info({ bookId, isRegen: !!qcFeedback, rawResponse: rawResult.substring(0, 500) }, 'Raw OpenAI response received');

      // Defensive: strip markdown code block wrapping if present
      let cleanedResult = rawResult.trim();
      if (cleanedResult.startsWith('```')) {
        cleanedResult = cleanedResult.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      try {
        return JSON.parse(cleanedResult) as StoryResponse;
      } catch (parseError) {
        logger.error({
          bookId,
          parseError: parseError instanceof Error ? parseError.message : 'Unknown parse error',
          rawResponseLength: rawResult.length,
          rawResponseFirst500: rawResult.substring(0, 500),
        }, 'Failed to parse OpenAI response');
        throw new Error(`Invalid JSON response from OpenAI: ${parseError instanceof Error ? parseError.message : 'unknown error'}`);
      }
    };

    let storyResponse = await generateStory();

    // Validate-or-DROP the model's proposed bridges (cap, one-per-gap,
    // roster-only characters). A bad bridge never fails the story — the book
    // simply stays a photo-per-page book.
    const validateBridges = (response: StoryResponse): StoryBridgePageResponse[] => {
      if (bridgeCap === 0) return [];
      const validation = validateBridgePages(response.bridgePages, {
        photoCount: storyPages.length,
        rosterCharacterIds: charactersInPhotos.map(c => c.characterId),
      });
      if ((response.bridgePages?.length ?? 0) > 0 || validation.dropped.length > 0) {
        logger.info(
          {
            bookId,
            bridgesProposed: response.bridgePages?.length ?? 0,
            bridgesAccepted: validation.accepted.length,
            bridgesDropped: validation.dropped,
          },
          'Bridge page validation',
        );
      }
      return validation.accepted;
    };
    let acceptedBridges = validateBridges(storyResponse);

    // Story QC: verify the draft before any illustration money is spent on it.
    // One regen max; QC errors and blown time budgets accept the draft as-is.
    await setGenerationPhase(bookId, 'story_check');
    let qcPassed = true;
    let regenerated = false;
    try {
      const verdict = await evaluateStoryQuality(openai, storyResponse, storyInput, bookId, acceptedBridges);
      if (!verdict.passed) {
        qcPassed = false;
        if (Date.now() - jobStartedAt < STORY_QC_TIME_BUDGET_MS) {
          logger.warn({ bookId, feedback: verdict.feedback }, 'Story QC failed — regenerating once with corrections');
          regenerated = true;
          // Back to 'story' so the story stage emits a mid-flight signal —
          // this write is also what keeps the UI's stall clock honest.
          await setGenerationPhase(bookId, 'story');
          storyResponse = await generateStory(verdict.feedback);
          acceptedBridges = validateBridges(storyResponse);
        } else {
          logger.warn({ bookId, feedback: verdict.feedback }, 'Story QC failed but time budget exhausted — accepting draft');
        }
      }
    } catch (qcError) {
      logger.warn({
        bookId,
        error: qcError instanceof Error ? qcError.message : 'Unknown QC error',
      }, 'Story QC errored — accepting draft without review');
    }

    // Prepare update data (not promises yet)
    interface PageUpdateData {
      pageId: string;
      text: string;
      illustrationNotes: string | null;
      textConfirmed: boolean;
    }
    let pageUpdates: PageUpdateData[] = [];

    try {
      logger.info({ bookId, pageCount: storyResponse.pages?.length }, 'Parsing story response');

      // Validate that all expected pages are present in response
      const expectedPageNumbers = storyPages.map((_, i) => i + 1);
      const receivedPageNumbers = storyResponse.pages?.map(p => p.pageNumber) || [];
      const missingPages = expectedPageNumbers.filter(p => !receivedPageNumbers.includes(p));

      if (missingPages.length > 0) {
        logger.warn({
          bookId,
          missingPages,
          expectedCount: expectedPageNumbers.length,
          receivedCount: receivedPageNumbers.length
        }, 'Some pages missing from OpenAI response');
      }

      // Prepare update data for all story pages
      pageUpdates = storyPages.map((page, index) => {
        const storyPosition = index + 1; // 1-based position
        const content = storyResponse.pages?.find(p => p.pageNumber === storyPosition);

        if (!content) {
          logger.warn({
            bookId,
            pageId: page.id,
            storyPosition,
            pageNumber: page.pageNumber
          }, 'No content generated for this page - using defaults');
        }

        // Fix for empty string bug: check if text exists AND is not empty after trim
        const trimmedText = content?.text?.trim() || '';
        const finalText = trimmedText.length > 0 ? trimmedText : `[Page ${storyPosition} text pending]`;

        // Normalize empty string illustrationNotes to null
        const notes = content?.illustrationNotes?.trim() || null;

        logger.info({
          bookId,
          pageId: page.id,
          pageNumber: page.pageNumber,
          index: page.index,
          storyPosition,
          finalTextLength: finalText.length,
          hadContent: !!content,
          usedFallback: !content || trimmedText.length === 0,
          textPreview: finalText.substring(0, 50),
          hasIllustrationNotes: !!notes
        }, 'Prepared page update');

        return {
          pageId: page.id,
          text: finalText,
          illustrationNotes: notes,
          textConfirmed: trimmedText.length > 0,
        };
      });
    } catch (mappingError) {
      logger.error({
        bookId,
        error: mappingError instanceof Error ? mappingError.message : 'Unknown error',
        responsePageCount: storyResponse.pages?.length,
      }, 'Failed to map story response onto pages');
      throw mappingError;
    }

    logger.info({
      bookId,
      totalPageUpdates: pageUpdates.length,
      expectedStoryPages: storyPages.length,
      matches: pageUpdates.length === storyPages.length
    }, 'Executing batch page updates via transaction');

    try {
      // Use $transaction with a callback to execute updates sequentially
      // This avoids SIGSEGV crashes from too many parallel Prisma queries
      const results = await prisma.$transaction(async (tx) => {
        const updateResults = [];
        for (const update of pageUpdates) {
          const result = await tx.page.update({
            where: { id: update.pageId },
            data: {
              text: update.text,
              illustrationNotes: update.illustrationNotes,
              textConfirmed: update.textConfirmed,
            },
          });
          updateResults.push(result);
        }

        // Bridge insertion + renumber, in the SAME transaction as the text
        // writes: interleave accepted bridges into the photo order, shift the
        // photo rows' index/pageNumber to their final positions, and keep
        // Book.pageLength truthful. No-op (zero extra writes) when no bridges
        // were accepted — the flag-off path is byte-identical to before.
        if (acceptedBridges.length > 0) {
          const plan = planPageSequence(storyPages.map(p => p.id), acceptedBridges);
          for (const entry of plan) {
            if (entry.kind === 'photo') {
              await tx.page.update({
                where: { id: entry.photoPageId! },
                data: { index: entry.index, pageNumber: entry.pageNumber },
              });
            } else {
              await tx.page.create({
                data: {
                  bookId,
                  index: entry.index,
                  pageNumber: entry.pageNumber,
                  text: entry.bridge!.text,
                  // Born with text — the review illustrate-gate must pass.
                  textConfirmed: true,
                  illustrationNotes: entry.bridge!.illustrationNotes,
                  source: 'BRIDGE',
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  bridgeScene: entry.bridge!.scene as any, // Prisma Json column
                  // assetId stays NULL: pointing at the anchor's asset would
                  // corrupt isTitlePage and character remapping.
                  assetId: null,
                  originalImageUrl: null,
                  isTitlePage: false,
                  pageType: 'SINGLE',
                  moderationStatus: 'PENDING',
                },
              });
            }
          }
          await tx.book.update({ where: { id: bookId }, data: { pageLength: plan.length } });
        }

        return updateResults;
      });
      logger.info({
        bookId,
        successfulUpdates: results.length,
        insertedBridges: acceptedBridges.length,
        totalExpected: storyPages.length
      }, 'Batch update completed');
    } catch (error) {
      logger.error({
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
        updateCount: pageUpdates.length
      }, 'Batch update failed');
      throw error;
    }

    // Verify all pages actually received text in the database
    const pagesAfterUpdate = await prisma.page.findMany({
      where: {
        bookId,
      },
      select: {
        id: true,
        pageNumber: true,
        index: true,
        text: true
      },
      orderBy: { index: 'asc' }
    });

    const pagesWithoutText = pagesAfterUpdate.filter(p => !p.text || p.text.trim().length === 0);

    if (pagesWithoutText.length > 0) {
      logger.error({
        bookId,
        totalStoryPages: pagesAfterUpdate.length,
        pagesWithoutText: pagesWithoutText.length,
        missingPageNumbers: pagesWithoutText.map(p => p.pageNumber),
        missingPageIndices: pagesWithoutText.map(p => p.index),
        pageUpdatesCreated: pageUpdates.length,
        expectedStoryPages: storyPages.length,
      }, 'CRITICAL: Some pages missing text after batch update - applying fallback');

      // Fix pages that didn't get text
      const fixPromises = pagesWithoutText.map((page) => {
        const fallbackText = `[Page ${page.pageNumber} text pending - please regenerate]`;
        logger.warn({
          bookId,
          pageId: page.id,
          pageNumber: page.pageNumber,
          fallbackText
        }, 'Applying fallback text to page that was missed');

        return prisma.page.update({
          where: { id: page.id },
          data: {
            text: fallbackText,
            textConfirmed: false
          }
        });
      });

      await Promise.all(fixPromises);
      logger.info({
        bookId,
        fixedPages: fixPromises.length
      }, 'Applied fallback text to pages that were missed');
    } else {
      logger.info({
        bookId,
        totalStoryPages: pagesAfterUpdate.length,
        allPagesHaveText: true
      }, 'Verification passed: All story pages have text');
    }

    // Persist the model's title when the book only had a placeholder
    const suggestedTitle = storyResponse.suggestedTitle?.trim();
    const shouldAdoptTitle = Boolean(job.data.titleWasGenerated && suggestedTitle);

    // Update book status to story ready (not yet illustrating)
    await prisma.book.update({
      where: { id: bookId },
      data: {
        status: 'STORY_READY',
        // STORY_READY is terminal for this worker — clear the phase; the
        // auto-chain (or the parent) decides what happens next.
        generationPhase: null,
        ...(shouldAdoptTitle ? { title: suggestedTitle!.slice(0, 100) } : {}),
        updatedAt: new Date(),
      },
    });

    if (shouldAdoptTitle) {
      logger.info({ bookId, title: suggestedTitle }, 'Adopted model-suggested book title');
    }

    // Funnel telemetry — never throws, never blocks the pipeline.
    await trackEvent(
      prisma,
      {
        name: 'story_ready',
        userId: book.userId,
        bookId,
        props: { regenerated, qcPassed, bridgePages: acceptedBridges.length },
      },
      logger,
    );

    // Auto-chain: hand the book straight to illustration. The chain re-enters
    // via character extraction, which owns the illustration FlowProducer flow.
    // A chain failure must NOT fail the story job — the book stays STORY_READY
    // and the user can start illustration manually.
    if (book.autoIllustrate) {
      try {
        await prisma.book.update({
          where: { id: bookId },
          data: { status: 'ILLUSTRATING' },
        });
        await getCharacterExtractionQueue().add(
          `extract-characters-${bookId}`,
          {
            bookId,
            userId,
            artStyle: book.artStyle || 'vignette',
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 500 },
          },
        );
        logger.info({ bookId }, 'Auto-chained into illustration via character extraction');
      } catch (chainError) {
        logger.error({
          bookId,
          error: chainError instanceof Error ? chainError.message : 'Unknown error',
        }, 'Auto-chain enqueue failed — reverting to STORY_READY for manual illustration');
        await prisma.book.update({
          where: { id: bookId, status: 'ILLUSTRATING' },
          data: { status: 'STORY_READY' },
        }).catch(() => {});
      }
    }

    logger.info({
      bookId,
      pagesUpdated: pageUpdates.length,
      totalStoryPages: storyPages.length,
      autoChained: book.autoIllustrate,
      allPagesHaveText: pageUpdates.length === storyPages.length
    }, 'Story generation completed');
    return { success: true, pagesUpdated: pageUpdates.length };

  } catch (error: any) {
    logger.error({
      error: error.message,
      bookId: job?.data?.bookId
    }, 'Story generation failed');

    // Update book status to failed if we have a bookId
    if (job?.data?.bookId) {
      await prisma.book.update({
        where: { id: job.data.bookId },
        data: { status: 'FAILED', generationPhase: null },
      }).catch(() => {}); // Ignore errors when updating status
    }

    throw error;
  }
}

/**
 * Generate text for a single page using surrounding narrative context.
 * Used when a user replaces a flagged photo on a PARTIAL book.
 * Does NOT change book status — the book stays PARTIAL.
 */
async function processSinglePageTextGeneration(
  job: Job,
  openai: OpenAI,
  bookId: string,
  pageId: string,
) {
  logger.info({ bookId, pageId, jobId: job.id }, 'Starting single-page text generation');

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

  const targetPage = book.pages.find(p => p.id === pageId);
  if (!targetPage) throw new Error('Target page not found');

  const photoUrl = targetPage.asset?.url || targetPage.asset?.thumbnailUrl || targetPage.originalImageUrl;
  if (!photoUrl) throw new Error('Target page has no photo');

  // Get all story pages for context
  const storyPages = book.pages;
  const targetIndex = storyPages.findIndex(p => p.id === pageId);

  const prevPages = storyPages.slice(Math.max(0, targetIndex - 2), targetIndex);
  const nextPages = storyPages.slice(targetIndex + 1, targetIndex + 3);

  const prevContext = prevPages.filter(p => p.text).map(p => `Page ${p.pageNumber}: "${p.text}"`).join('\n');
  const nextContext = nextPages.filter(p => p.text).map(p => `Page ${p.pageNumber}: "${p.text}"`).join('\n');

  // Parse additional characters
  let characterInfo = '';
  if (book.childName) {
    characterInfo = `The main character is named "${book.childName}".`;
    if (book.additionalCharacters) {
      try {
        const chars = JSON.parse(book.additionalCharacters) as Array<{ name: string; relationship: string }>;
        if (chars.length > 0) {
          characterInfo += ` Other characters: ${chars.map(c => `"${c.name}" (${c.relationship})`).join(', ')}.`;
        }
      } catch { /* ignore parse errors */ }
    }
  }

  // Context parity with full generation: cast, eventSummary + confirmed
  // facts, and this page's fresh perception analysis. The perception roster
  // is durable here — both refresh enqueues are DRAFT-gated, so post-DRAFT
  // perception never re-runs; only page remapping is needed. The capture-
  // answer merge is re-applied in memory (the full-generation pass already
  // persisted it; this just guards odd orderings), and consumed answers stay
  // out of the fact lines exactly like the first pass.
  const captureQuestions = (book.captureQuestions as StoredCaptureQuestion[] | null) ?? [];
  const rawIdentity = book.characterIdentity as StoredCharacterIdentity | null;
  let cast: ResolvedCastEntry[] = [];
  let consumedQuestionIds = new Set<string>();
  if (rawIdentity?.characters?.length) {
    const merge = mergeCastNames({
      characters: rawIdentity.characters,
      captureQuestions,
      childName: book.childName,
    });
    consumedQuestionIds = new Set(merge.consumedQuestionIds);
    cast = resolveCastEntries(merge.characters, storyPages.map(p => p.assetId));
  }
  const castInfo = cast.length > 0
    ? `People in this book's photos: ${cast
        .map(c => `"${c.name}" (${c.role.replace(/_/g, ' ')})`)
        .join(', ')}. NEVER invent a proper name — for unnamed people use the warm relationship word a toddler would say ("Grandma", "Daddy"); for unnamed pets use "the dog" / "the cat".`
    : '';

  const confirmedFacts = buildConfirmedFacts(
    captureQuestions.filter(q => !consumedQuestionIds.has(q.id)),
  );
  // Exactly ONE experience-context block, eventSummary superseding theme —
  // same condition as full generation.
  const eventContext = book.eventSummary
    ? [
        `## What actually happened (confirmed by the parent — the story must feel TRUE to this):`,
        `- "${book.eventSummary}"`,
        ...confirmedFacts.map(f => `- Parent confirmed: ${f}`),
      ].join('\n')
    : book.theme
      ? `## Story context from the parent:\n"${book.theme}"`
      : '';

  const storedAnalysis = targetPage.analysis as StoredPageAnalysis | null;
  // Stale analysis (photo was swapped since the perception pass) is dropped.
  const freshAnalysis = storedAnalysis && storedAnalysis.assetId === targetPage.assetId ? storedAnalysis : null;
  const analysisLine = freshAnalysis
    ? `WHAT'S HERE in this page's photo (raw notes, NOT the story): ${freshAnalysis.setting}; ${freshAnalysis.action}; ${freshAnalysis.emotion}.${
        freshAnalysis.eventSignals?.length ? ` Signals: ${freshAnalysis.eventSignals.join(', ')}.` : ''
      } ARC ROLE: ${freshAnalysis.narrativeRole}.`
    : '';

  const language = book.language || 'en';
  const languageInstruction = language === 'ja'
    ? 'Write the story text in Japanese (hiragana preferred for young children). Use simple, warm language.'
    : 'Write the story text in English.';

  const promptText = [
    `You are writing page ${targetPage.pageNumber} of a children's picture book titled "${book.title || 'My Special Story'}".`,
    characterInfo,
    castInfo,
    languageInstruction,
    '',
    ...(eventContext ? [eventContext, ''] : []),
    prevContext ? `## Story so far (previous pages):\n${prevContext}` : '## This is near the beginning of the story.',
    '',
    `## Your task:`,
    `Write story text for page ${targetPage.pageNumber} based on the photo provided. Write 2-4 sentences (max 50 words). The text should feel warm, playful, and natural when read aloud to a toddler.`,
    ...(analysisLine ? [analysisLine] : []),
    '',
    nextContext ? `## What comes after (for continuity):\n${nextContext}` : '## This is near the end of the story.',
    '',
    `Also provide brief illustrationNotes describing any visual effects or mood for the illustrator, or null if the photo speaks for itself.`,
  ].join('\n');

  const imageUrl = optimizeCloudinaryUrlForVision(convertHeicToJpeg(photoUrl));

  const SINGLE_PAGE_SCHEMA = {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Story text (2-4 sentences, max 50 words)' },
      illustrationNotes: { type: ['string', 'null'], description: 'Visual notes for illustrator, or null' },
    },
    required: ['text', 'illustrationNotes'],
    additionalProperties: false,
  } as const;

  const result = await openai.responses.create({
    model: STORY_MODEL,
    instructions: STORY_GENERATION_SYSTEM_PROMPT,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: imageUrl, detail: 'high' as const },
          { type: 'input_text', text: promptText },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'single_page_story',
        strict: true,
        schema: SINGLE_PAGE_SCHEMA as Record<string, unknown>,
      },
    },
  });

  const responseText = result.output_text;
  if (!responseText) throw new Error('OpenAI returned empty response for single page');

  const parsed = JSON.parse(responseText) as { text: string; illustrationNotes: string | null };

  await prisma.page.update({
    where: { id: pageId },
    data: {
      text: parsed.text,
      illustrationNotes: parsed.illustrationNotes,
      textConfirmed: false,
    },
  });

  logger.info({ bookId, pageId, textLength: parsed.text.length }, 'Single-page text generation completed');
  return { success: true, pageId, text: parsed.text };
}
