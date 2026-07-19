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
  createAvatarStoryPrompt,
  AvatarStoryGenerationInput,
  AvatarStoryResponse,
  AVATAR_STORY_SYSTEM_PROMPT,
  STORY_RESPONSE_SCHEMA_AVATAR,
  AvatarPageScene,
  BeatSheetEntry,
} from '@storywink/shared/prompts/story';
import {
  createStoryQCPrompt,
  STORY_QC_SYSTEM_PROMPT,
  STORY_QC_RESPONSE_SCHEMA,
  STORY_QC_THRESHOLDS,
  StoryQCResponse,
  createAvatarStoryQCPrompt,
  AVATAR_STORY_QC_SYSTEM_PROMPT,
  AVATAR_STORY_QC_RESPONSE_SCHEMA,
  AvatarStoryQCResponse,
  countRefrainEchoes,
  countLearningWordEchoes,
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
  shouldPurgeStaleBridges,
} from '../lib/bridge-pages.js';
import { toysComeAliveEnabled } from '../lib/toys-come-alive.js';
import {
  mergeCastNames,
  resolveCastEntries,
  checkCastNameCoverage,
  MergedCastCharacter,
  ResolvedCastEntry,
  CastCoverageResult,
} from '../lib/resolveCast.js';
import {
  buildAvatarCastForPrompt,
  extractAvatarScene,
  reconcileSceneCastWithText,
  avatarStoryQcProblems,
} from '../lib/avatar-story.js';
import { storyQualityV2Enabled, deterministicStoryChecks } from '../lib/story-quality.js';
import { persistStoryQc } from '../lib/story-qc-persist.js';
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
// never turn a working story job into a hung one. Doubled for STORY QUALITY
// V2's quality-first stance (up to MAX_STORY_REGENS full regens fit inside).
const STORY_QC_TIME_BUDGET_MS = Number(process.env.STORY_QC_TIME_BUDGET_MS || 360_000);

// Whole-book regenerations allowed per job (each re-evaluated by QC).
const MAX_STORY_REGENS = Number(process.env.STORY_MAX_REGENS || 2);

// Surgical single-page rewrites allowed per QC round — only for page-local
// deterministic violations (word cap / name garble) on an otherwise-passing
// draft, where a whole-book regen would waste money and risk regressions.
const MAX_TARGETED_REWRITES = Number(process.env.STORY_MAX_TARGETED_REWRITES || 3);

/** The QC verdict the regen loop drives on. */
interface StoryQcVerdict {
  passed: boolean;
  feedback: string;
  /** V2: page-local deterministic violations (integer pages only). */
  pageLocal: { pageNumber: number; issue: string }[];
  /** True when pageLocal is ALL that is failing — eligible for surgical rewrites. */
  pageLocalOnly: boolean;
  /** Full score payload for StoryQcResult persistence (same object the log line carries). */
  telemetry: Record<string, unknown>;
}

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
): Promise<StoryQcVerdict> {
  const problems: string[] = [];
  const sortedPages = [...storyResponse.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  // Photo-positional texts (page 1..N = storyboard photos), used where
  // positions matter (castNameCoverage's appearsOnPages windows).
  const pageTexts = sortedPages.map((p) => p.text || '');

  // Reading-order texts (bridges interleaved) — the book the parent will
  // actually read. Refrain echoes and the childName counts judge this.
  const bridgesByGap = new Map(acceptedBridges.map((b) => [b.afterPhotoPage, b]));
  const readingOrderTexts: string[] = [];
  sortedPages.forEach((p) => {
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
    ...sortedPages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
    ...acceptedBridges.map((b) => ({
      pageNumber: b.afterPhotoPage + 0.5,
      text: `[BRIDGE PAGE — inserted after page ${b.afterPhotoPage}, generated without a photo]\n${b.text}`,
    })),
  ].sort((a, b) => a.pageNumber - b.pageNumber);

  const refrain = storyResponse.storyArc?.refrain || '';
  const echoes = countRefrainEchoes(refrain, readingOrderTexts, input.language);

  // LOG-ONLY: learning-word dose. Every enforcing check risks a silent extra
  // generation during the parent's wait, so this ships as telemetry first.
  if (input.learningWords?.length) {
    const wordCounts = input.learningWords.map((word) => ({
      word,
      pages: countLearningWordEchoes(word, readingOrderTexts, input.language),
    }));
    logger.info(
      { bookId, wordCounts, target: '3-4 pages per word' },
      'Learning-word echo counts (log-only)',
    );
  }
  if (echoes < STORY_QC_THRESHOLDS.minRefrainEchoes) {
    problems.push(
      `The refrain "${refrain}" is only recognizable on ${echoes} page(s). It must echo (with variation) on at least ${STORY_QC_THRESHOLDS.minRefrainEchoes} pages.`,
    );
  }

  // STORY QUALITY V2: deterministic word/sentence caps + name-garble scan
  // over the true reading sequence (bridges at N + 0.5, label-free text).
  // Always computed for telemetry; the flag decides whether they block.
  const v2Enforced = storyQualityV2Enabled();
  const rosterNames = [
    input.childName,
    ...(input.charactersInPhotos ?? []).map((c) => c.name),
  ].filter((n): n is string => !!n?.trim());
  const detChecks = deterministicStoryChecks(
    [
      ...sortedPages.map((p) => ({ pageNumber: p.pageNumber, text: p.text || '' })),
      ...acceptedBridges.map((b) => ({ pageNumber: b.afterPhotoPage + 0.5, text: b.text })),
    ],
    rosterNames,
    input.language || 'en',
  );

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
              beatSheet: storyResponse.beatSheet,
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

  const telemetry = {
    bookId,
    refrainEchoes: echoes,
    arcCoherence: qc.arcCoherence,
    readAloudRhythm: qc.readAloudRhythm,
    lastPageLanding: qc.lastPageLanding,
    maxCaptionRisk: Math.max(0, ...qc.pages.map((p) => p.captionRisk)),
    childNameCheck,
    childNameEchoes,
    childNameInLanding,
    castNamesChecked: castCoverage?.checked ?? 0,
    castNamesCovered: castCoverage?.covered ?? 0,
    castNamesMissing: castCoverage?.missing ?? [],
    castNamesSkippedScript: castCoverage?.skippedScript ?? 0,
    truthToEvent: qc.truthToEvent,
    // ENFORCED on photo (S2): a sound-overloaded draft is regenerated.
    soundOverload: qc.soundOverload,
    // ENFORCED under STORY_QUALITY_V2 (log-only when the flag is off).
    agency: qc.agency,
    hadEventSummary: !!input.eventSummary,
    confirmedFactCount: input.confirmedFacts?.length ?? 0,
    // STORY QUALITY V2 telemetry (always computed; enforced only when flagged).
    v2Enforced,
    wordBudgetViolations: detChecks.budget,
    nameGarbles: detChecks.garbles,
    rollCallPages: detChecks.rollCall.map((r) => r.pageNumber),
    deliversBeatFalse: qc.pages.filter((p) => p.deliversBeat === false).map((p) => p.pageNumber),
    orphanedLanding: qc.orphanedLanding,
    refrainAsNarrator: qc.refrainAsNarrator,
    endsFlatPages: qc.pages.filter((p) => p.endsLeaningForward === false).map((p) => p.pageNumber),
  };
  logger.info(telemetry, 'Story QC scores');

  if (qc.arcCoherence < STORY_QC_THRESHOLDS.minArcCoherence) {
    problems.push(
      `Arc coherence scored ${qc.arcCoherence}/10 — the pages must actually deliver the declared desire → escalation → peak → soft landing.`,
    );
  }
  if (qc.readAloudRhythm < STORY_QC_THRESHOLDS.minReadAloudRhythm) {
    problems.push(
      `Read-aloud rhythm scored ${qc.readAloudRhythm}/10 — vary sentence lengths and make it musical when spoken.`,
    );
  }
  if (!qc.lastPageLanding) {
    problems.push('The final page must land as a soft, warm exhale — no summary statements.');
  }
  for (const page of qc.pages) {
    if (page.captionRisk > STORY_QC_THRESHOLDS.maxCaptionRisk) {
      problems.push(
        `Page ${page.pageNumber} reads like a photo caption (risk ${page.captionRisk}/10). ${page.issue || "Rewrite from the child's inner experience."}`,
      );
    }
  }
  // ENFORCED on photo books (S2): the avatar path logs the same flag but never
  // regenerates on it (see evaluateAvatarStoryQuality).
  if (qc.soundOverload) {
    problems.push(
      "The story leans on sound words. Cut them back to at most one per page, and never as a page's main event — reach for a vivid verb or an image instead.",
    );
  }
  // STORY QUALITY V2 (flag-gated): agency and per-page beat delivery join the
  // enforced set; the deterministic word/garble findings block below.
  if (v2Enforced) {
    if (qc.agency < STORY_QC_THRESHOLDS.minAgency) {
      problems.push(
        `Agency scored ${qc.agency}/10 — the child must be the DOER: one clear goal, a real obstacle, and a try-wobble-try before the payoff.`,
      );
    }
    // X16 W1: the parent-confirmed day is enforced, not advisory. Photo books
    // without an eventSummary score null and are exempt.
    if (
      input.eventSummary &&
      qc.truthToEvent !== null &&
      qc.truthToEvent < STORY_QC_THRESHOLDS.minTruthToEvent
    ) {
      problems.push(
        `truthToEvent scored ${qc.truthToEvent}/10 — the story must deliver the parent's actual day ("${input.eventSummary}"): its people, its place, its moments. A story that could be about any day fails.`,
      );
    }
    const beats = new Map((storyResponse.beatSheet ?? []).map((b) => [b.pageNumber, b]));
    for (const page of qc.pages) {
      if (page.deliversBeat === false) {
        const beat = beats.get(page.pageNumber);
        problems.push(
          `Page ${page.pageNumber} does not deliver its declared beat${
            beat ? ` (${beat.role} — ${beat.goal})` : ''
          } — rewrite the page to do that job.${page.issue ? ` ${page.issue}` : ''}`,
        );
      }
    }
    if (qc.orphanedLanding === true) {
      problems.push(
        'A person from the opening pages has vanished by the landing — bring them back (or echo them) on the final page.',
      );
    }
    if (qc.refrainAsNarrator === false) {
      problems.push(
        'The refrain must appear at least twice as its own standalone narrator line, OUTSIDE quotation marks — at most one echo may live inside dialogue.',
      );
    }
  }
  // Everything above needs a whole-book regen; the deterministic findings are
  // page-local and can be fixed surgically when they are the only failures.
  const globalProblemCount = problems.length;
  if (v2Enforced) {
    problems.push(...detChecks.problems);
  }
  if (problems.length > 0 && qc.feedback) {
    problems.push(qc.feedback);
  }

  const pageLocal = v2Enforced
    ? [
        // ja budget findings are log-only until the char band is calibrated.
        ...(input.language === 'ja'
          ? []
          : detChecks.budget.map((b) => ({ pageNumber: b.pageNumber, issue: b.issue }))),
        ...detChecks.garbles.map((g) => ({
          pageNumber: g.pageNumber,
          issue: `Page ${g.pageNumber} garbles character names ("${g.snippet}") — use each name correctly and separately.`,
        })),
      ].filter((p) => Number.isInteger(p.pageNumber))
    : [];

  return {
    passed: problems.length === 0,
    feedback: problems.map((p, i) => `${i + 1}. ${p}`).join('\n'),
    pageLocal,
    // Bridge violations (N + 0.5) have no in-memory page to rewrite — they
    // force the whole-book path via the length mismatch.
    pageLocalOnly:
      v2Enforced &&
      globalProblemCount === 0 &&
      pageLocal.length > 0 &&
      pageLocal.length === detChecks.problems.length,
    telemetry,
  };
}

/**
 * Editorial review for AVATAR_STORY books (X6d). Same shape as the photo
 * evaluator — deterministic refrain in code, one regen max — but captionRisk
 * is meaningless without photos and is dropped; premiseTruth (does the story
 * deliver the parent-picked spark?) is scored LOG-ONLY, mirroring the
 * telemetry-first rollout of every other new check.
 */
async function evaluateAvatarStoryQuality(
  openai: OpenAI,
  storyResponse: StoryResponse,
  input: AvatarStoryGenerationInput,
  bookId: string,
): Promise<StoryQcVerdict> {
  const sortedPages = [...storyResponse.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const pageTexts = sortedPages.map((p) => p.text || '');
  const sceneOf = (p: (typeof sortedPages)[number]) =>
    (p as AvatarStoryResponse['pages'][number]).scene;

  const refrain = storyResponse.storyArc?.refrain || '';
  const echoes = countRefrainEchoes(refrain, pageTexts, input.language);

  // LOG-ONLY: learning-word dose, same telemetry as the photo path.
  if (input.learningWords?.length) {
    const wordCounts = input.learningWords.map((word) => ({
      word,
      pages: countLearningWordEchoes(word, pageTexts, input.language),
    }));
    logger.info(
      { bookId, wordCounts, target: '3-4 pages per word' },
      'Learning-word echo counts (log-only)',
    );
  }

  // STORY QUALITY V2: deterministic caps + garble scan (always computed;
  // the flag decides whether they block).
  const v2Enforced = storyQualityV2Enabled();
  const rosterNames = [input.childName, ...input.cast.map((c) => c.name)].filter(
    (n): n is string => !!n?.trim(),
  );
  const detChecks = deterministicStoryChecks(
    sortedPages.map((p) => ({ pageNumber: p.pageNumber, text: p.text || '' })),
    rosterNames,
    input.language || 'en',
  );

  const result = await openai.responses.create({
    model: ANALYSIS_MODEL,
    instructions: AVATAR_STORY_QC_SYSTEM_PROMPT,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: createAvatarStoryQCPrompt({
              storyArc: storyResponse.storyArc,
              pages: sortedPages.map((p) => ({
                pageNumber: p.pageNumber,
                text: p.text,
                sceneAction: sceneOf(p)?.action ?? null,
                sceneFocus: sceneOf(p)?.focus ?? null,
              })),
              language: input.language,
              premise: input.premise,
              cast: input.cast.map((c) => ({ name: c.name, role: c.role })),
              beatSheet: storyResponse.beatSheet,
            }),
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'avatar_story_qc',
        strict: true,
        schema: AVATAR_STORY_QC_RESPONSE_SCHEMA as Record<string, unknown>,
      },
    },
  });

  if (!result.output_text) throw new Error('Story QC returned empty response');
  const qc = JSON.parse(result.output_text) as AvatarStoryQCResponse;

  // LOG-ONLY childName echoes, script-gated exactly like the photo path.
  const childName = input.childName?.trim();
  let childNameCheck: 'checked' | 'skipped' | 'absent' = 'absent';
  let childNameEchoes: number | null = null;
  let childNameInLanding: boolean | null = null;
  if (childName) {
    if (isChildNameCheckable(childName, input.language || 'en')) {
      const nameEchoes = countChildNameEchoes(childName, pageTexts);
      childNameCheck = 'checked';
      childNameEchoes = nameEchoes.pagesWithName;
      childNameInLanding = nameEchoes.nameInLanding;
    } else {
      childNameCheck = 'skipped';
    }
  }

  const telemetry = {
    bookId,
    bookType: 'AVATAR_STORY',
    refrainEchoes: echoes,
    arcCoherence: qc.arcCoherence,
    readAloudRhythm: qc.readAloudRhythm,
    lastPageLanding: qc.lastPageLanding,
    // LOG-ONLY dimension: premiseTruth never pushes into `problems` at
    // launch (flip to enforcing only after Railway data validates the
    // distribution — every new trigger is a silent extra generation).
    premiseTruth: qc.premiseTruth,
    // soundOverload enforces on PHOTO books only; agency enforces under
    // STORY_QUALITY_V2 (log-only when the flag is off).
    soundOverload: qc.soundOverload,
    agency: qc.agency,
    pageIssues: qc.pages.filter((p) => p.issue).length,
    childNameCheck,
    childNameEchoes,
    childNameInLanding,
    castSize: input.cast.length,
    // STORY QUALITY V2 telemetry (always computed; enforced only when flagged).
    v2Enforced,
    wordBudgetViolations: detChecks.budget,
    nameGarbles: detChecks.garbles,
    rollCallPages: detChecks.rollCall.map((r) => r.pageNumber),
    deliversBeatFalse: qc.pages.filter((p) => p.deliversBeat === false).map((p) => p.pageNumber),
    sceneMismatchPages: qc.pages
      .filter((p) => p.sceneMatchesText === false)
      .map((p) => p.pageNumber),
  };
  logger.info(telemetry, 'Story QC scores');

  // The enforced-dimension verdict is pure and pinned by tests — premiseTruth
  // stays LOG-ONLY by construction. The no-deterministic variant tells the
  // regen loop whether surgical page rewrites alone can clear the draft.
  const v2Options = { enforce: v2Enforced, beatSheet: storyResponse.beatSheet };
  const globalProblems = avatarStoryQcProblems(qc, refrain, echoes, v2Options);
  const problems = avatarStoryQcProblems(qc, refrain, echoes, {
    ...v2Options,
    deterministicProblems: detChecks.problems,
  });

  const pageLocal = v2Enforced
    ? [
        // ja budget findings are log-only until the char band is calibrated.
        ...(input.language === 'ja'
          ? []
          : detChecks.budget.map((b) => ({ pageNumber: b.pageNumber, issue: b.issue }))),
        ...detChecks.garbles.map((g) => ({
          pageNumber: g.pageNumber,
          issue: `Page ${g.pageNumber} garbles character names ("${g.snippet}") — use each name correctly and separately.`,
        })),
      ]
    : [];

  return {
    passed: problems.length === 0,
    feedback: problems.map((p, i) => `${i + 1}. ${p}`).join('\n'),
    pageLocal,
    pageLocalOnly: v2Enforced && globalProblems.length === 0 && pageLocal.length > 0,
    telemetry,
  };
}

/**
 * STORY QUALITY V2: surgical fix for a page-local violation (word cap / name
 * garble) on an otherwise-passing draft — rewrite ONE page's text in place
 * instead of regenerating the whole book. The page's beat, neighbors,
 * refrain, and (on avatar) its scene pin the moment so only the words change.
 */
async function rewriteSinglePageText(
  openai: OpenAI,
  opts: {
    bookTitle: string;
    language: string;
    refrain: string;
    isAvatarStory: boolean;
    pageNumber: number;
    currentText: string;
    violation: string;
    beat?: BeatSheetEntry;
    prevText?: string;
    nextText?: string;
    sceneAction?: string | null;
  },
): Promise<string> {
  const lengthRule =
    opts.language === 'ja'
      ? '1-2 sentences, 20-45 characters (hard cap 48), Japanese hiragana with no kanji'
      : '1-2 sentences, 15-30 words (hard cap 30)';
  const promptText = [
    `You are fixing ONE page of the children's picture book "${opts.bookTitle}".`,
    `Page ${opts.pageNumber} failed editorial review: ${opts.violation}`,
    `Current page text: "${opts.currentText}"`,
    opts.beat
      ? `This page's beat (it must still deliver this): ${opts.beat.role} — ${opts.beat.goal}`
      : '',
    opts.sceneAction
      ? `The illustration for this page shows: ${opts.sceneAction}. The text must narrate this same moment.`
      : '',
    opts.prevText ? `Previous page: "${opts.prevText}"` : '',
    opts.nextText ? `Next page: "${opts.nextText}"` : '',
    opts.refrain
      ? `The book's refrain is "${opts.refrain}" — keep an echo of it only if the current text has one.`
      : '',
    `Rewrite ONLY this page's text: same moment, same characters, same lean into the next page — ${lengthRule}.`,
  ]
    .filter(Boolean)
    .join('\n');

  const result = await openai.responses.create({
    model: STORY_MODEL,
    instructions: opts.isAvatarStory ? AVATAR_STORY_SYSTEM_PROMPT : STORY_GENERATION_SYSTEM_PROMPT,
    input: [{ role: 'user', content: [{ type: 'input_text', text: promptText }] }],
    text: {
      format: {
        type: 'json_schema',
        name: 'single_page_rewrite',
        strict: true,
        schema: {
          type: 'object',
          properties: { text: { type: 'string', description: 'The rewritten page text' } },
          required: ['text'],
          additionalProperties: false,
        } as Record<string, unknown>,
      },
    },
  });
  if (!result.output_text) throw new Error('Single-page rewrite returned empty response');
  return (JSON.parse(result.output_text) as { text: string }).text;
}

export async function processStoryGeneration(
  job: Job<StoryGenerationJob & { singlePageId?: string; titleWasGenerated?: boolean }>,
) {
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

    // AVATAR_STORY (X6d): every page of an avatar book is a photo-less
    // BRIDGE-source row authored at creation time — they ARE the book, not
    // derivatives of a previous story, so the purge below must never touch
    // them. Keyed on the DB row (bookType), never on a flag.
    const isAvatarStory = book.bookType === 'AVATAR_STORY';

    // PURGE-AT-START (bridge pages): BRIDGE rows are app-authored derivatives
    // of a PREVIOUS story, so a fresh generation must never inherit them —
    // this makes BullMQ retries idempotent and re-generation from COMPLETED
    // clean. Data-driven rather than flag-gated: stale rows left behind by a
    // flag rollback must not survive a regen either. Runs BEFORE the
    // pageLength comparison below so the mismatch warn can't fire spuriously,
    // and pageLength is recomputed in the same transaction.
    if (shouldPurgeStaleBridges(book.bookType, book.pages)) {
      const survivors = book.pages.filter((p) => p.source !== 'BRIDGE');
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
        {
          bookId,
          purgedBridges: book.pages.length - survivors.length,
          remainingPages: survivors.length,
        },
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
    logger.info(
      {
        bookId,
        totalPages: book.pages.length,
        coverAssetId: book.coverAssetId,
        storyPagesCount: storyPages.length,
        expectedPageLength: book.pageLength,
        actualPageLength: book.pages.length,
        storyPageDetails: storyPages.map((p) => ({
          id: p.id,
          index: p.index,
          pageNumber: p.pageNumber,
          assetId: p.assetId,
          hasExistingText: !!p.text,
        })),
      },
      'Story generation page analysis',
    );

    // Validate page count
    if (storyPages.length !== book.pageLength) {
      logger.warn(
        {
          bookId,
          storyPagesCount: storyPages.length,
          expectedStoryPages: book.pageLength,
          bookPageLength: book.pageLength,
          totalPagesInBook: book.pages.length,
        },
        'Page count mismatch - story pages vs expected',
      );
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
              namedCharacters: mergedCharacters.filter((c) => c.name).length,
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
      captureQuestions.filter((q) => !consumedQuestionIds.has(q.id)),
    );

    // appearsOnPages is creation-order-positional; remap per character to the
    // CURRENT page order via the perception pass's assetId stamps. Characters
    // whose photos were all removed are dropped (never reintroduce removed
    // people); partially-resolvable characters stay in the cast page-less
    // rather than asserting wrong page numbers.
    // AVATAR_STORY: the roster has no asset stamps (there are no photos) —
    // resolveCastEntries would drop everyone. The cast reaches the prompt via
    // buildAvatarCastForPrompt below instead.
    const charactersInPhotos =
      !isAvatarStory && mergedCharacters.length
        ? resolveCastEntries(
            mergedCharacters,
            storyPages.map((p) => p.assetId),
          )
        : [];

    // BRIDGE_PAGES_ENABLED: request bridges only when the flag is on AND a
    // grounded roster exists (identity-less books get no bridges — there is
    // nothing to validate charactersPresent against). Cap is code-enforced
    // again at validation time. AVATAR_STORY books never get bridges: every
    // page is already photo-less, regardless of the bridge flag.
    const bridgeCap =
      !isAvatarStory && bridgePagesEnabled() && charactersInPhotos.length > 0
        ? bridgeCapForPhotoCount(storyPages.length)
        : 0;

    // TOYS_COME_ALIVE_ENABLED (X13 Track T): flips a companion_object cast
    // member from grounded object to living companion. Read once, threaded into
    // both the photo and avatar prompt inputs. Default OFF → prompt untouched.
    const toysAlive = toysComeAliveEnabled();

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
      learningWords: (() => {
        const raw = book.learningWords as { word?: string }[] | null;
        const words = (raw ?? [])
          .map((w) => (typeof w?.word === 'string' ? w.word.trim() : ''))
          .filter(Boolean)
          .slice(0, 4);
        return words.length > 0 ? words : undefined;
      })(),
      charactersInPhotos: charactersInPhotos.length > 0 ? charactersInPhotos : undefined,
      bridgeCap: bridgeCap > 0 ? bridgeCap : undefined,
      toysComeAlive: toysAlive,
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

    // AVATAR_STORY (X6d): the premise (stored on eventSummary at creation)
    // replaces the photo storyboard; the cast is the stored avatar roster,
    // page-less; the model plans the page sequence and emits a structured
    // scene per page.
    const avatarInput: AvatarStoryGenerationInput | null = isAvatarStory
      ? {
          bookTitle: book.title || 'My Special Story',
          pageCount: storyPages.length,
          premise:
            book.eventSummary?.trim() || book.theme?.trim() || 'a wonderful adventure together',
          cast: buildAvatarCastForPrompt(mergedCharacters),
          childName: book.childName || undefined,
          tone: book.tone || undefined,
          language: book.language || 'en',
          suggestTitle: job.data.titleWasGenerated === true,
          qcFeedback: undefined,
          learningWords: storyInput.learningWords,
          toysComeAlive: toysAlive,
        }
      : null;

    if (isAvatarStory) {
      logger.info(
        {
          bookId,
          castSize: avatarInput!.cast.length,
          pageCount: avatarInput!.pageCount,
          hasPremise: !!book.eventSummary?.trim(),
        },
        'Avatar-story generation input assembled',
      );
    }

    const jobStartedAt = Date.now();

    // Generate the story (optionally with editorial corrections from a failed QC round)
    const generateStory = async (qcFeedback?: string): Promise<StoryResponse> => {
      const promptParts = isAvatarStory
        ? createAvatarStoryPrompt({ ...avatarInput!, qcFeedback })
        : createStoryGenerationPrompt({ ...storyInput, qcFeedback });
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
        instructions: isAvatarStory ? AVATAR_STORY_SYSTEM_PROMPT : STORY_GENERATION_SYSTEM_PROMPT,
        input: [{ role: 'user', content: contentParts }],
        text: {
          format: {
            type: 'json_schema',
            name: 'story_response',
            strict: true,
            // The bridge-enabled schema is requested ONLY when the prompt
            // carries the bridge section; flag-off requests are byte-identical
            // to the legacy schema. AVATAR_STORY requests the scene-per-page
            // variant instead.
            schema: (isAvatarStory
              ? STORY_RESPONSE_SCHEMA_AVATAR
              : bridgeCap > 0
                ? STORY_RESPONSE_SCHEMA_WITH_BRIDGES
                : STORY_RESPONSE_SCHEMA) as unknown as Record<string, unknown>,
          },
        },
      });

      const rawResult = result.output_text;
      if (!rawResult) {
        throw new Error('OpenAI returned empty response');
      }

      logger.info(
        { bookId, isRegen: !!qcFeedback, rawResponse: rawResult.substring(0, 500) },
        'Raw OpenAI response received',
      );

      // Defensive: strip markdown code block wrapping if present
      let cleanedResult = rawResult.trim();
      if (cleanedResult.startsWith('```')) {
        cleanedResult = cleanedResult.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      try {
        return JSON.parse(cleanedResult) as StoryResponse;
      } catch (parseError) {
        logger.error(
          {
            bookId,
            parseError: parseError instanceof Error ? parseError.message : 'Unknown parse error',
            rawResponseLength: rawResult.length,
            rawResponseFirst500: rawResult.substring(0, 500),
          },
          'Failed to parse OpenAI response',
        );
        throw new Error(
          `Invalid JSON response from OpenAI: ${parseError instanceof Error ? parseError.message : 'unknown error'}`,
        );
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
        rosterCharacterIds: charactersInPhotos.map((c) => c.characterId),
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
    // Up to MAX_STORY_REGENS whole-book regens inside the time budget, each
    // re-evaluated; page-local deterministic violations (word cap / garble) on
    // an otherwise-passing draft get surgical single-page rewrites instead.
    // QC errors and blown budgets still accept the draft — fail-open, but
    // fail-loud via story_qc_failopen telemetry.
    await setGenerationPhase(bookId, 'story_check');
    let qcPassed = true;
    let regenerated = false;
    let regenCount = 0;
    let targetedRewrites = 0;

    // Shared context for the surgical rewrites.
    const bookLanguage = (isAvatarStory ? avatarInput!.language : storyInput.language) || 'en';
    const rewriteRosterNames = (
      isAvatarStory
        ? [avatarInput!.childName, ...avatarInput!.cast.map((c) => c.name)]
        : [storyInput.childName, ...(storyInput.charactersInPhotos ?? []).map((c) => c.name)]
    ).filter((n): n is string => !!n?.trim());

    const applyTargetedRewrites = async (verdict: StoryQcVerdict): Promise<StoryQcVerdict> => {
      if (
        verdict.passed ||
        !verdict.pageLocalOnly ||
        verdict.pageLocal.length === 0 ||
        verdict.pageLocal.length > MAX_TARGETED_REWRITES ||
        Date.now() - jobStartedAt >= STORY_QC_TIME_BUDGET_MS
      ) {
        return verdict;
      }
      const sorted = [...storyResponse.pages].sort((a, b) => a.pageNumber - b.pageNumber);
      const byNumber = new Map(sorted.map((p) => [p.pageNumber, p]));
      const beats = new Map((storyResponse.beatSheet ?? []).map((b) => [b.pageNumber, b]));
      // One rewrite per page: a page with BOTH a budget and a garble finding
      // gets a single call carrying every issue, never two competing rewrites.
      const violationsByPage = new Map<number, string[]>();
      for (const violation of verdict.pageLocal) {
        const issues = violationsByPage.get(violation.pageNumber) ?? [];
        issues.push(violation.issue);
        violationsByPage.set(violation.pageNumber, issues);
      }
      for (const [pageNumber, issues] of violationsByPage) {
        const page = byNumber.get(pageNumber);
        if (!page) continue;
        try {
          const newText = (
            await rewriteSinglePageText(openai, {
              bookTitle: book.title || 'My Special Story',
              language: bookLanguage,
              refrain: storyResponse.storyArc?.refrain || '',
              isAvatarStory,
              pageNumber,
              currentText: page.text,
              violation: issues.join(' '),
              beat: beats.get(pageNumber),
              prevText: byNumber.get(pageNumber - 1)?.text,
              nextText: byNumber.get(pageNumber + 1)?.text,
              sceneAction: isAvatarStory
                ? ((page as AvatarStoryResponse['pages'][number]).scene?.action ?? null)
                : null,
            })
          ).trim();
          if (!newText) {
            // An empty rewrite would sail through the deterministic recheck
            // (0 words = no violation) and brick illustration downstream.
            logger.warn(
              { bookId, pageNumber },
              'Targeted rewrite returned empty text — keeping original page',
            );
            continue;
          }
          page.text = newText;
          targetedRewrites++;
          if (storyInput.learningWords?.length) {
            page.learningWordsUsed = storyInput.learningWords.filter(
              (word) => countLearningWordEchoes(word, [newText], bookLanguage) > 0,
            );
          }
          logger.info(
            { bookId, pageNumber, event: 'story_page_targeted_rewrite' },
            'Targeted single-page rewrite applied',
          );
        } catch (rewriteError) {
          logger.warn(
            {
              bookId,
              pageNumber,
              error: rewriteError instanceof Error ? rewriteError.message : 'Unknown error',
            },
            'Targeted single-page rewrite failed — leaving page as-is',
          );
        }
      }
      // Deterministic re-check only: the model-scored dimensions already
      // passed, and only the rewritten pages changed. The refrain floor IS
      // re-counted — a rewrite can delete the one echo a page carried.
      const recheckPages = [...storyResponse.pages].sort((a, b) => a.pageNumber - b.pageNumber);
      const recheck = deterministicStoryChecks(
        recheckPages.map((p) => ({ pageNumber: p.pageNumber, text: p.text || '' })),
        rewriteRosterNames,
        bookLanguage,
      );
      const recheckProblems = [...recheck.problems];
      const refrain = storyResponse.storyArc?.refrain || '';
      const echoesAfter = countRefrainEchoes(
        refrain,
        recheckPages.map((p) => p.text || ''),
        bookLanguage,
      );
      if (echoesAfter < STORY_QC_THRESHOLDS.minRefrainEchoes) {
        recheckProblems.push(
          `The refrain "${refrain}" is only recognizable on ${echoesAfter} page(s) after the rewrite. It must echo (with variation) on at least ${STORY_QC_THRESHOLDS.minRefrainEchoes} pages.`,
        );
      }
      return {
        passed: recheckProblems.length === 0,
        feedback: recheckProblems.map((p, i) => `${i + 1}. ${p}`).join('\n'),
        pageLocal: [],
        pageLocalOnly: false,
        telemetry: verdict.telemetry,
      };
    };

    try {
      const evaluate = (): Promise<StoryQcVerdict> =>
        isAvatarStory
          ? evaluateAvatarStoryQuality(openai, storyResponse, avatarInput!, bookId)
          : evaluateStoryQuality(openai, storyResponse, storyInput, bookId, acceptedBridges);

      const persistVerdict = (v: StoryQcVerdict, round: number) =>
        persistStoryQc(prisma, {
          bookId,
          bookType: book.bookType,
          language: bookLanguage,
          round,
          passed: v.passed,
          scores: v.telemetry as Record<string, unknown>,
          feedback: v.feedback || null,
          targetedRewrites,
        });

      let verdict = await evaluate();
      verdict = await applyTargetedRewrites(verdict);
      await persistVerdict(verdict, 0);
      while (
        !verdict.passed &&
        regenCount < MAX_STORY_REGENS &&
        Date.now() - jobStartedAt < STORY_QC_TIME_BUDGET_MS
      ) {
        regenCount++;
        regenerated = true;
        logger.warn(
          { bookId, attempt: regenCount, feedback: verdict.feedback },
          'Story QC failed — regenerating with corrections',
        );
        // Back to 'story' so the story stage emits a mid-flight signal —
        // this write is also what keeps the UI's stall clock honest.
        await setGenerationPhase(bookId, 'story');
        storyResponse = await generateStory(verdict.feedback);
        acceptedBridges = validateBridges(storyResponse);
        await setGenerationPhase(bookId, 'story_check');
        verdict = await evaluate();
        verdict = await applyTargetedRewrites(verdict);
        await persistVerdict(verdict, regenCount);
      }
      qcPassed = verdict.passed;
      if (!verdict.passed) {
        logger.warn(
          { bookId, regenCount, feedback: verdict.feedback },
          'Story QC still failing after regen budget — accepting draft (fail-open)',
        );
        await trackEvent(
          prisma,
          {
            name: 'story_qc_failopen',
            userId: book.userId,
            bookId,
            props: { regenCount, targetedRewrites, reason: 'thresholds', bookType: book.bookType },
          },
          logger,
        );
      }
    } catch (qcError) {
      logger.warn(
        {
          bookId,
          error: qcError instanceof Error ? qcError.message : 'Unknown QC error',
        },
        'Story QC errored — accepting draft without review',
      );
      await trackEvent(
        prisma,
        {
          name: 'story_qc_failopen',
          userId: book.userId,
          bookId,
          props: { regenCount, targetedRewrites, reason: 'qc_error', bookType: book.bookType },
        },
        logger,
      );
    }

    // Prepare update data (not promises yet)
    interface PageUpdateData {
      pageId: string;
      text: string;
      illustrationNotes: string | null;
      textConfirmed: boolean;
      learningWordsUsed: string[];
      /** AVATAR_STORY only: validated model scene → Page.bridgeScene. */
      bridgeScene?: AvatarPageScene | null;
      /** Photo books only (STORY QUALITY V2): per-page mood cue → Page.illustrationMood. */
      illustrationMood?: string | null;
    }
    let pageUpdates: PageUpdateData[] = [];

    // AVATAR_STORY: validate-or-degrade each page's scene before persisting.
    // A malformed scene never fails the job — the page renders from text.
    const rosterIdsForScenes = isAvatarStory
      ? (avatarInput!.cast.map((c) => c.characterId) ?? [])
      : [];
    // The same roster paired with display names — the B2 cross-check matches
    // these names against each page's text to catch cast the model wrote into
    // the prose but dropped from scene.charactersPresent.
    const rosterForScenes = isAvatarStory
      ? avatarInput!.cast.map((c) => ({ characterId: c.characterId, name: c.name }))
      : [];

    try {
      logger.info({ bookId, pageCount: storyResponse.pages?.length }, 'Parsing story response');

      // Validate that all expected pages are present in response
      const expectedPageNumbers = storyPages.map((_, i) => i + 1);
      const receivedPageNumbers = storyResponse.pages?.map((p) => p.pageNumber) || [];
      const missingPages = expectedPageNumbers.filter((p) => !receivedPageNumbers.includes(p));

      if (missingPages.length > 0) {
        logger.warn(
          {
            bookId,
            missingPages,
            expectedCount: expectedPageNumbers.length,
            receivedCount: receivedPageNumbers.length,
          },
          'Some pages missing from OpenAI response',
        );
      }

      // Prepare update data for all story pages
      pageUpdates = storyPages.map((page, index) => {
        const storyPosition = index + 1; // 1-based position
        const content = storyResponse.pages?.find((p) => p.pageNumber === storyPosition);

        if (!content) {
          logger.warn(
            {
              bookId,
              pageId: page.id,
              storyPosition,
              pageNumber: page.pageNumber,
            },
            'No content generated for this page - using defaults',
          );
        }

        // Fix for empty string bug: check if text exists AND is not empty after trim
        const trimmedText = content?.text?.trim() || '';
        const finalText =
          trimmedText.length > 0 ? trimmedText : `[Page ${storyPosition} text pending]`;

        // Normalize empty string illustrationNotes to null
        const notes = content?.illustrationNotes?.trim() || null;

        logger.info(
          {
            bookId,
            pageId: page.id,
            pageNumber: page.pageNumber,
            index: page.index,
            storyPosition,
            finalTextLength: finalText.length,
            hadContent: !!content,
            usedFallback: !content || trimmedText.length === 0,
            textPreview: finalText.substring(0, 50),
            hasIllustrationNotes: !!notes,
          },
          'Prepared page update',
        );

        // AVATAR_STORY: carry the validated scene along (photo books: undefined).
        const rawScene = isAvatarStory
          ? (content as AvatarStoryResponse['pages'][number] | undefined)?.scene
          : undefined;
        let scene = isAvatarStory ? extractAvatarScene(rawScene, rosterIdsForScenes) : undefined;
        if (isAvatarStory && rawScene && !scene) {
          logger.warn(
            { bookId, pageId: page.id, storyPosition },
            'Avatar page scene failed validation — page will render from text alone',
          );
        }
        // B2 cross-check: text and scene are independent model outputs, so a
        // character the page TEXT names can be missing from charactersPresent —
        // and the illustrator only ever sees the scene. Union-repair before
        // persist so the named cast can never silently vanish from the art.
        if (isAvatarStory && scene) {
          const reconciled = reconcileSceneCastWithText(scene, finalText, rosterForScenes);
          scene = reconciled.scene;
          if (reconciled.repair) {
            logger.info(
              {
                bookId,
                pageId: page.id,
                event: 'scene_cast_repaired',
                pageNumber: page.pageNumber,
                storyPosition,
                addedIds: reconciled.repair.addedIds,
                textNames: reconciled.repair.textNames,
              },
              'Scene cast auto-repaired from page text (union)',
            );
          }
        }

        return {
          pageId: page.id,
          text: finalText,
          illustrationNotes: notes,
          textConfirmed: trimmedText.length > 0,
          learningWordsUsed: content?.learningWordsUsed ?? [],
          ...(isAvatarStory
            ? { bridgeScene: scene }
            : // Persisted unconditionally (avatar pages carry scene.mood
              // instead); STORY_ILLUS_MOOD_ENABLED gates rendering.
              { illustrationMood: content?.moodCue?.trim() || null }),
        };
      });
    } catch (mappingError) {
      logger.error(
        {
          bookId,
          error: mappingError instanceof Error ? mappingError.message : 'Unknown error',
          responsePageCount: storyResponse.pages?.length,
        },
        'Failed to map story response onto pages',
      );
      throw mappingError;
    }

    logger.info(
      {
        bookId,
        totalPageUpdates: pageUpdates.length,
        expectedStoryPages: storyPages.length,
        matches: pageUpdates.length === storyPages.length,
      },
      'Executing batch page updates via transaction',
    );

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
              learningWordsUsed: update.learningWordsUsed,
              // AVATAR_STORY: persist the validated scene (or clear a stale
              // one from a previous run). Photo books never touch the column.
              ...(update.bridgeScene !== undefined
                ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  { bridgeScene: (update.bridgeScene ?? null) as any } // Prisma Json column
                : {}),
              // Photo books: per-page mood cue (or clear a stale one).
              ...(update.illustrationMood !== undefined
                ? { illustrationMood: update.illustrationMood }
                : {}),
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
          const plan = planPageSequence(
            storyPages.map((p) => p.id),
            acceptedBridges,
          );
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
                  learningWordsUsed: entry.bridge!.learningWordsUsed ?? [],
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
      logger.info(
        {
          bookId,
          successfulUpdates: results.length,
          insertedBridges: acceptedBridges.length,
          totalExpected: storyPages.length,
        },
        'Batch update completed',
      );
    } catch (error) {
      logger.error(
        {
          bookId,
          error: error instanceof Error ? error.message : 'Unknown error',
          updateCount: pageUpdates.length,
        },
        'Batch update failed',
      );
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
        text: true,
      },
      orderBy: { index: 'asc' },
    });

    const pagesWithoutText = pagesAfterUpdate.filter((p) => !p.text || p.text.trim().length === 0);

    if (pagesWithoutText.length > 0) {
      logger.error(
        {
          bookId,
          totalStoryPages: pagesAfterUpdate.length,
          pagesWithoutText: pagesWithoutText.length,
          missingPageNumbers: pagesWithoutText.map((p) => p.pageNumber),
          missingPageIndices: pagesWithoutText.map((p) => p.index),
          pageUpdatesCreated: pageUpdates.length,
          expectedStoryPages: storyPages.length,
        },
        'CRITICAL: Some pages missing text after batch update - applying fallback',
      );

      // Fix pages that didn't get text
      const fixPromises = pagesWithoutText.map((page) => {
        const fallbackText = `[Page ${page.pageNumber} text pending - please regenerate]`;
        logger.warn(
          {
            bookId,
            pageId: page.id,
            pageNumber: page.pageNumber,
            fallbackText,
          },
          'Applying fallback text to page that was missed',
        );

        return prisma.page.update({
          where: { id: page.id },
          data: {
            text: fallbackText,
            textConfirmed: false,
          },
        });
      });

      await Promise.all(fixPromises);
      logger.info(
        {
          bookId,
          fixedPages: fixPromises.length,
        },
        'Applied fallback text to pages that were missed',
      );
    } else {
      logger.info(
        {
          bookId,
          totalStoryPages: pagesAfterUpdate.length,
          allPagesHaveText: true,
        },
        'Verification passed: All story pages have text',
      );
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
        props: {
          regenerated,
          qcPassed,
          bridgePages: acceptedBridges.length,
          bookType: book.bookType,
        },
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
        logger.error(
          {
            bookId,
            error: chainError instanceof Error ? chainError.message : 'Unknown error',
          },
          'Auto-chain enqueue failed — reverting to STORY_READY for manual illustration',
        );
        await prisma.book
          .update({
            where: { id: bookId, status: 'ILLUSTRATING' },
            data: { status: 'STORY_READY' },
          })
          .catch(() => {});
      }
    }

    logger.info(
      {
        bookId,
        pagesUpdated: pageUpdates.length,
        totalStoryPages: storyPages.length,
        autoChained: book.autoIllustrate,
        allPagesHaveText: pageUpdates.length === storyPages.length,
      },
      'Story generation completed',
    );
    return { success: true, pagesUpdated: pageUpdates.length };
  } catch (error: any) {
    logger.error(
      {
        error: error.message,
        bookId: job?.data?.bookId,
      },
      'Story generation failed',
    );

    // Update book status to failed if we have a bookId
    if (job?.data?.bookId) {
      await prisma.book
        .update({
          where: { id: job.data.bookId },
          data: { status: 'FAILED', generationPhase: null },
        })
        .catch(() => {}); // Ignore errors when updating status
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

  const targetPage = book.pages.find((p) => p.id === pageId);
  if (!targetPage) throw new Error('Target page not found');

  // AVATAR_STORY (X6d): pages have no photos by design — the rewrite runs
  // from the premise, the cast, and this page's stored scene instead.
  const isAvatarStory = book.bookType === 'AVATAR_STORY';
  const photoUrl =
    targetPage.asset?.url || targetPage.asset?.thumbnailUrl || targetPage.originalImageUrl;
  if (!photoUrl && !isAvatarStory) throw new Error('Target page has no photo');

  // Get all story pages for context
  const storyPages = book.pages;
  const targetIndex = storyPages.findIndex((p) => p.id === pageId);

  const prevPages = storyPages.slice(Math.max(0, targetIndex - 2), targetIndex);
  const nextPages = storyPages.slice(targetIndex + 1, targetIndex + 3);

  const prevContext = prevPages
    .filter((p) => p.text)
    .map((p) => `Page ${p.pageNumber}: "${p.text}"`)
    .join('\n');
  const nextContext = nextPages
    .filter((p) => p.text)
    .map((p) => `Page ${p.pageNumber}: "${p.text}"`)
    .join('\n');

  // Parse additional characters
  let characterInfo = '';
  if (book.childName) {
    characterInfo = `The main character is named "${book.childName}".`;
    if (book.additionalCharacters) {
      try {
        const chars = JSON.parse(book.additionalCharacters) as Array<{
          name: string;
          relationship: string;
        }>;
        if (chars.length > 0) {
          characterInfo += ` Other characters: ${chars.map((c) => `"${c.name}" (${c.relationship})`).join(', ')}.`;
        }
      } catch {
        /* ignore parse errors */
      }
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
    cast = resolveCastEntries(
      merge.characters,
      storyPages.map((p) => p.assetId),
    );
  }
  // AVATAR_STORY: the roster has no asset stamps, so resolveCastEntries
  // drops everyone — read the stored roster directly instead.
  const avatarCast = isAvatarStory ? buildAvatarCastForPrompt(rawIdentity?.characters) : [];
  const castInfo = isAvatarStory
    ? avatarCast.length > 0
      ? `The cast of this story (picked by the parent): ${avatarCast
          .map((c) => `"${c.name}" (${c.role.replace(/_/g, ' ')})`)
          .join(', ')}. NEVER invent a new character or proper name.`
      : ''
    : cast.length > 0
      ? `People in this book's photos: ${cast
          .map((c) => `"${c.name}" (${c.role.replace(/_/g, ' ')})`)
          .join(
            ', ',
          )}. NEVER invent a proper name — for unnamed people use the warm relationship word a toddler would say ("Grandma", "Daddy"); for unnamed pets use "the dog" / "the cat".`
      : '';

  const confirmedFacts = buildConfirmedFacts(
    captureQuestions.filter((q) => !consumedQuestionIds.has(q.id)),
  );
  // Exactly ONE experience-context block, eventSummary superseding theme —
  // same condition as full generation. AVATAR_STORY: eventSummary holds the
  // parent-picked premise, so it gets spark framing, not what-happened framing.
  const eventContext = isAvatarStory
    ? book.eventSummary
      ? `## The spark this story was built on (picked by the parent):\n- "${book.eventSummary}"\n- This page must stay inside the spark's promise — it is an invented adventure, not a real day.`
      : ''
    : book.eventSummary
      ? [
          `## What actually happened (confirmed by the parent — the story must feel TRUE to this):`,
          `- "${book.eventSummary}"`,
          ...confirmedFacts.map((f) => `- Parent confirmed: ${f}`),
        ].join('\n')
      : book.theme
        ? `## Story context from the parent:\n"${book.theme}"`
        : '';
  // Mood parity with full generation: a regenerated page must stay in the
  // same key the parent picked for the book.
  const moodContext = book.tone
    ? `## Story Mood (picked by the parent):\n- The parent asked for a "${book.tone}" telling. Keep this page's lines in that key.`
    : '';

  const storedAnalysis = targetPage.analysis as StoredPageAnalysis | null;
  // Stale analysis (photo was swapped since the perception pass) is dropped.
  const freshAnalysis =
    storedAnalysis && storedAnalysis.assetId === targetPage.assetId ? storedAnalysis : null;
  const analysisLine = freshAnalysis
    ? `WHAT'S HERE in this page's photo (raw notes, NOT the story): ${freshAnalysis.setting}; ${freshAnalysis.action}; ${freshAnalysis.emotion}.${
        freshAnalysis.eventSignals?.length
          ? ` Signals: ${freshAnalysis.eventSignals.join(', ')}.`
          : ''
      } ARC ROLE: ${freshAnalysis.narrativeRole}.`
    : '';

  const language = book.language || 'en';
  const languageInstruction =
    language === 'ja'
      ? 'Write the story text in Japanese (hiragana preferred for young children). Use simple, warm language.'
      : 'Write the story text in English.';

  const promptText = [
    `You are writing page ${targetPage.pageNumber} of a children's picture book titled "${book.title || 'My Special Story'}".`,
    characterInfo,
    castInfo,
    languageInstruction,
    '',
    ...(moodContext ? [moodContext, ''] : []),
    ...(eventContext ? [eventContext, ''] : []),
    prevContext
      ? `## Story so far (previous pages):\n${prevContext}`
      : '## This is near the beginning of the story.',
    '',
    `## Your task:`,
    isAvatarStory
      ? `Write story text for page ${targetPage.pageNumber} based on this page's scene and the story around it. Write 1-2 sentences, 15-30 words (hard cap 30). The text should feel warm, playful, and natural when read aloud to a toddler.`
      : `Write story text for page ${targetPage.pageNumber} based on the photo provided. Write 1-2 sentences, 15-30 words (hard cap 30). The text should feel warm, playful, and natural when read aloud to a toddler.`,
    ...(analysisLine ? [analysisLine] : []),
    ...(isAvatarStory && targetPage.bridgeScene
      ? [
          `THIS PAGE'S SCENE (what the illustration will show): ${JSON.stringify(targetPage.bridgeScene)}`,
        ]
      : []),
    '',
    nextContext
      ? `## What comes after (for continuity):\n${nextContext}`
      : '## This is near the end of the story.',
    '',
    `Also provide brief illustrationNotes describing any visual effects or mood for the illustrator, or null if the photo speaks for itself.`,
  ].join('\n');

  const imageUrl = photoUrl ? optimizeCloudinaryUrlForVision(convertHeicToJpeg(photoUrl)) : null;

  const SINGLE_PAGE_SCHEMA = {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Story text (1-2 sentences, 15-30 words)' },
      illustrationNotes: {
        type: ['string', 'null'],
        description: 'Visual notes for illustrator, or null',
      },
    },
    required: ['text', 'illustrationNotes'],
    additionalProperties: false,
  } as const;

  const result = await openai.responses.create({
    model: STORY_MODEL,
    instructions: isAvatarStory ? AVATAR_STORY_SYSTEM_PROMPT : STORY_GENERATION_SYSTEM_PROMPT,
    input: [
      {
        role: 'user',
        content: [
          ...(imageUrl
            ? [{ type: 'input_image' as const, image_url: imageUrl, detail: 'high' as const }]
            : []),
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

  let parsed = JSON.parse(responseText) as { text: string; illustrationNotes: string | null };

  // STORY QUALITY V2: this path used to ship with no QC at all. Run the
  // deterministic caps + garble scan; one retry with the violation named,
  // then accept (a slightly long page beats a stuck PARTIAL book).
  if (storyQualityV2Enabled()) {
    const singlePageRoster = [
      book.childName,
      ...(isAvatarStory ? avatarCast.map((c) => c.name) : cast.map((c) => c.name)),
    ].filter((n): n is string => !!n?.trim());
    const check = deterministicStoryChecks(
      [{ pageNumber: targetPage.pageNumber, text: parsed.text }],
      singlePageRoster,
      language,
    );
    if (check.problems.length > 0) {
      logger.warn(
        { bookId, pageId, problems: check.problems },
        'Single-page draft failed deterministic checks — retrying once',
      );
      const retry = await openai.responses.create({
        model: STORY_MODEL,
        instructions: isAvatarStory ? AVATAR_STORY_SYSTEM_PROMPT : STORY_GENERATION_SYSTEM_PROMPT,
        input: [
          {
            role: 'user',
            content: [
              ...(imageUrl
                ? [{ type: 'input_image' as const, image_url: imageUrl, detail: 'high' as const }]
                : []),
              {
                type: 'input_text',
                text: `${promptText}\n\nYOUR PREVIOUS ATTEMPT FAILED EDITORIAL REVIEW:\n"${parsed.text}"\n${check.problems.join('\n')}\nRewrite within 1-2 sentences, 15-30 words, using each character name correctly.`,
              },
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
      if (retry.output_text) {
        parsed = JSON.parse(retry.output_text) as {
          text: string;
          illustrationNotes: string | null;
        };
        const recheck = deterministicStoryChecks(
          [{ pageNumber: targetPage.pageNumber, text: parsed.text }],
          singlePageRoster,
          language,
        );
        if (recheck.problems.length > 0) {
          logger.warn(
            { bookId, pageId, problems: recheck.problems },
            'Single-page retry still violates deterministic checks — accepting (fail-open)',
          );
        }
      }
    }
  }

  await prisma.page.update({
    where: { id: pageId },
    data: {
      text: parsed.text,
      illustrationNotes: parsed.illustrationNotes,
      textConfirmed: false,
      // The old mood cue described the PREVIOUS text's moment — clear it so
      // a stale tone can never color the new render (this path emits none).
      illustrationMood: null,
    },
  });

  logger.info(
    { bookId, pageId, textLength: parsed.text.length },
    'Single-page text generation completed',
  );
  return { success: true, pageId, text: parsed.text };
}
