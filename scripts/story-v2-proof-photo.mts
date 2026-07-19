/**
 * STORY QUALITY V2 proof run — PHOTO path. Picks the most recent local
 * photo book that has images + fresh perception analysis, regenerates its
 * story through the NEW photo prompt + schema (vision inputs included),
 * and judges it with QC v2 (deterministic checks + beat-aware judge,
 * enforcement ON). Read-only against the DB — nothing is persisted.
 *
 * Run from the monorepo root:
 *   npx tsx scripts/story-v2-proof-photo.mts [bookId]
 * Writes proof artifacts to .screenshots/story-v2-proof-photo.{json,md}.
 */
import { config as dotenv } from 'dotenv';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import {
  createStoryGenerationPrompt,
  STORY_GENERATION_SYSTEM_PROMPT,
  STORY_RESPONSE_SCHEMA,
  type StoryResponse,
  type StoryGenerationInput,
} from '@storywink/shared/prompts/story';
import {
  createStoryQCPrompt,
  STORY_QC_SYSTEM_PROMPT,
  STORY_QC_RESPONSE_SCHEMA,
  STORY_QC_THRESHOLDS,
  type StoryQCResponse,
  countRefrainEchoes,
  countWords,
  countSentences,
} from '@storywink/shared/prompts/story-check';
import { optimizeCloudinaryUrlForVision, convertHeicToJpeg } from '@storywink/shared/utils';
import { deterministicStoryChecks } from '../apps/workers/src/lib/story-quality.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv({ path: path.join(ROOT, 'apps/workers/.env') });

const STORY_MODEL = process.env.STORY_MODEL || 'gpt-5.6';
const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'gpt-5-mini';

interface StoredAnalysis {
  assetId?: string | null;
  setting: string;
  action: string;
  emotion: string;
  eventSignals: string[];
  narrativeRole: string;
}

/**
 * `--synthetic`: no local photo book needed. Four hosted photos of a child's
 * park outing with authored perception notes (incl. narrativeRole hints) —
 * the cleanest possible check that beats are ASSIGNED onto the fixed photo
 * order (opening→setup … closing→resolution) rather than invented.
 */
function syntheticBook() {
  const photos: { url: string; analysis: StoredAnalysis }[] = [
    {
      url: 'https://images.unsplash.com/photo-1476234251651-f353703a034d?w=1024&q=80',
      analysis: {
        setting: 'a leafy park path in morning light',
        action: 'a small child walks ahead holding a grown-up hand',
        emotion: 'curious, expectant',
        eventSignals: ['start of an outing'],
        narrativeRole: 'opening',
      },
    },
    {
      url: 'https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?w=1024&q=80',
      analysis: {
        setting: 'open grass near a big old tree',
        action: 'the child runs toward something ahead',
        emotion: 'eager, determined',
        eventSignals: ['chasing, reaching'],
        narrativeRole: 'rising',
      },
    },
    {
      url: 'https://images.unsplash.com/photo-1489710437720-ebb67ec84dd2?w=1024&q=80',
      analysis: {
        setting: 'under the tree, dappled shade',
        action: 'the child jumps with arms up at the highest branch',
        emotion: 'thrilled, triumphant',
        eventSignals: ['peak effort'],
        narrativeRole: 'peak',
      },
    },
    {
      url: 'https://images.unsplash.com/photo-1471286174890-9c112ffca5b4?w=1024&q=80',
      analysis: {
        setting: 'golden late-afternoon light on the way home',
        action: 'the child rests, carried close',
        emotion: 'content, sleepy',
        eventSignals: ['winding down'],
        narrativeRole: 'closing',
      },
    },
  ];
  return {
    id: 'synthetic',
    title: 'The Tallest Branch',
    childName: 'Emma',
    status: 'DRAFT',
    language: 'en',
    tone: 'adventurous',
    theme: null,
    eventSummary: "Emma's park adventure to reach the tallest branch of the old oak",
    pages: photos.map((p, i) => ({
      id: `synthetic-${i + 1}`,
      pageNumber: i + 1,
      assetId: null,
      originalImageUrl: p.url,
      analysis: p.analysis,
    })),
  };
}

async function main() {
  const prisma = new PrismaClient();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const requestedId = process.argv[2];
  const synthetic = requestedId === '--synthetic';
  const candidates = await prisma.book.findMany({
    where: requestedId ? { id: requestedId } : { bookType: { not: 'AVATAR_STORY' } },
    select: {
      id: true,
      title: true,
      childName: true,
      status: true,
      language: true,
      tone: true,
      theme: true,
      eventSummary: true,
      pages: {
        select: {
          id: true,
          pageNumber: true,
          assetId: true,
          originalImageUrl: true,
          analysis: true,
        },
        orderBy: { index: 'asc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: requestedId ? 1 : 10,
  });

  const book = synthetic
    ? syntheticBook()
    : candidates.find((b) => b.pages.length >= 4 && b.pages.every((p) => p.originalImageUrl));
  if (!book) {
    console.log(
      '[proof-photo] no local photo book with images on every page — listing candidates:',
    );
    for (const b of candidates) {
      console.log(
        `  ${b.id} | ${b.title} | pages ${b.pages.length} | withImg ${b.pages.filter((p) => p.originalImageUrl).length}`,
      );
    }
    await prisma.$disconnect();
    process.exit(2);
  }
  console.log(
    `[proof-photo] book ${book.id} "${book.title}" (${book.pages.length} pages, child: ${book.childName})`,
  );

  const input: StoryGenerationInput = {
    bookTitle: book.title || 'My Special Story',
    isDoubleSpread: false,
    childName: book.childName || undefined,
    tone: book.tone || undefined,
    theme: book.theme || undefined,
    eventSummary: book.eventSummary || undefined,
    language: book.language || 'en',
    suggestTitle: false,
    storyPages: book.pages.map((p) => {
      const analysis = p.analysis as StoredAnalysis | null;
      const fresh = analysis && (!analysis.assetId || analysis.assetId === p.assetId);
      return {
        pageId: p.id,
        pageNumber: p.pageNumber,
        assetId: p.assetId,
        originalImageUrl: p.originalImageUrl,
        analysis: fresh
          ? {
              setting: analysis.setting,
              action: analysis.action,
              emotion: analysis.emotion,
              eventSignals: analysis.eventSignals ?? [],
              narrativeRole: analysis.narrativeRole,
            }
          : null,
      };
    }),
  };

  console.log(`[proof-photo] generating with ${STORY_MODEL} (vision)…`);
  const started = Date.now();

  const generate = async (qcFeedback?: string): Promise<StoryResponse> => {
    const promptParts = createStoryGenerationPrompt({ ...input, qcFeedback });
    const content: Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_image'; image_url: string; detail: 'high' }
    > = [];
    for (const part of promptParts) {
      if ('type' in part && part.type === 'image_placeholder') {
        // The Cloudinary vision optimizer only applies to Cloudinary URLs;
        // synthetic (stock) photos pass through raw.
        const url = part.imageUrl.includes('cloudinary')
          ? optimizeCloudinaryUrlForVision(convertHeicToJpeg(part.imageUrl))
          : part.imageUrl;
        content.push({ type: 'input_image', image_url: url, detail: 'high' });
      } else if ('text' in part) {
        content.push({ type: 'input_text', text: part.text });
      }
    }
    const result = await openai.responses.create({
      model: STORY_MODEL,
      instructions: STORY_GENERATION_SYSTEM_PROMPT,
      input: [{ role: 'user', content }],
      text: {
        format: {
          type: 'json_schema',
          name: 'story_response',
          strict: true,
          schema: STORY_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });
    if (!result.output_text) throw new Error('empty story response');
    return JSON.parse(result.output_text) as StoryResponse;
  };

  let story = await generate();
  const genMs = Date.now() - started;
  let regenerated = false;

  const rosterNames = [book.childName].filter((n): n is string => !!n?.trim());

  // Mirrors the worker's photo evaluator: deterministic checks + beat-aware
  // model judge, assembled into the numbered feedback the regen prompt gets.
  const judge = async (draft: StoryResponse) => {
    const sorted = [...draft.pages].sort((a, b) => a.pageNumber - b.pageNumber);
    const pageTexts = sorted.map((p) => p.text);
    const det = deterministicStoryChecks(
      sorted.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
      rosterNames,
      book.language || 'en',
    );
    const echoes = countRefrainEchoes(draft.storyArc.refrain, pageTexts, book.language || 'en');
    console.log(`[proof-photo] QC judge (${ANALYSIS_MODEL})…`);
    const qcResult = await openai.responses.create({
      model: ANALYSIS_MODEL,
      instructions: STORY_QC_SYSTEM_PROMPT,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: createStoryQCPrompt({
                storyArc: draft.storyArc,
                pages: sorted.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
                language: book.language || 'en',
                theme: book.theme || undefined,
                eventSummary: book.eventSummary || undefined,
                beatSheet: draft.beatSheet,
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
          schema: STORY_QC_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });
    if (!qcResult.output_text) throw new Error('empty QC response');
    const qc = JSON.parse(qcResult.output_text) as StoryQCResponse;

    const problems: string[] = [];
    if (echoes < STORY_QC_THRESHOLDS.minRefrainEchoes)
      problems.push(`The refrain echoes on only ${echoes} page(s); it needs 3+.`);
    if (qc.arcCoherence < STORY_QC_THRESHOLDS.minArcCoherence)
      problems.push(`Arc coherence ${qc.arcCoherence}/10 — deliver the declared arc.`);
    if (qc.readAloudRhythm < STORY_QC_THRESHOLDS.minReadAloudRhythm)
      problems.push(`Read-aloud rhythm ${qc.readAloudRhythm}/10 — vary and musicalize.`);
    if (!qc.lastPageLanding)
      problems.push('The final page must land as a soft, warm exhale — no summary statements.');
    for (const page of qc.pages) {
      if (page.captionRisk > STORY_QC_THRESHOLDS.maxCaptionRisk)
        problems.push(`Page ${page.pageNumber} reads like a caption. ${page.issue ?? ''}`);
      if (page.deliversBeat === false)
        problems.push(`Page ${page.pageNumber} does not deliver its declared beat.`);
    }
    if (qc.soundOverload) problems.push('Cut sound words back to at most one per page.');
    if (qc.agency < STORY_QC_THRESHOLDS.minAgency)
      problems.push(`Agency ${qc.agency}/10 — the child must be the DOER.`);
    problems.push(...det.problems);
    if (problems.length > 0 && qc.feedback) problems.push(qc.feedback);
    return { sorted, det, echoes, qc, problems };
  };

  // Accumulate every evaluation round so the artifact keeps the pre-regen
  // draft + its problems, not just the final surviving draft. This is the
  // proof that the regen loop fired and what it fired on. Round labels match
  // StoryQcResult.round semantics: 0 = first draft, 1 = first regen.
  const rounds: {
    round: number;
    problems: string[];
    pages: { pageNumber: number; text: string }[];
  }[] = [];

  let round = await judge(story);
  rounds.push({
    round: 0,
    problems: round.problems,
    pages: round.sorted.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
  });
  if (round.problems.length > 0) {
    console.log(
      `[proof-photo] round 0 failed (${round.problems.length} problems) — regenerating once with corrections (mirrors the worker loop)…`,
    );
    regenerated = true;
    story = await generate(round.problems.map((p, i) => `${i + 1}. ${p}`).join('\n'));
    round = await judge(story);
    rounds.push({
      round: 1,
      problems: round.problems,
      pages: round.sorted.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
    });
  }
  const { sorted, det, echoes, qc } = round;

  const arcRoles = input.storyPages.map((p) => p.analysis?.narrativeRole ?? '—');
  const pages = sorted.map((p, i) => ({
    pageNumber: p.pageNumber,
    words: countWords(p.text),
    sentences: countSentences(p.text),
    arcRole: arcRoles[i],
    beat: story.beatSheet.find((b) => b.pageNumber === p.pageNumber),
    moodCue: p.moodCue ?? null,
    text: p.text,
  }));

  const summary = {
    model: STORY_MODEL,
    bookId: book.id,
    genMs,
    regenerated,
    remainingProblems: round.problems,
    throughline: story.storyArc.throughline,
    refrain: story.storyArc.refrain,
    refrainEchoes: echoes,
    beatRoles: story.beatSheet.map((b) => `${b.pageNumber}:${b.role}`),
    arcRoleHints: arcRoles,
    wordRange: [Math.min(...pages.map((p) => p.words)), Math.max(...pages.map((p) => p.words))],
    maxSentences: Math.max(...pages.map((p) => p.sentences)),
    moodCues: pages.map((p) => p.moodCue),
    deterministicProblems: det.problems,
    garbles: det.garbles,
    qcScores: {
      arcCoherence: qc.arcCoherence,
      readAloudRhythm: qc.readAloudRhythm,
      lastPageLanding: qc.lastPageLanding,
      truthToEvent: qc.truthToEvent,
      agency: qc.agency,
      soundOverload: qc.soundOverload,
      maxCaptionRisk: Math.max(0, ...qc.pages.map((p) => p.captionRisk)),
      deliversBeatFalse: qc.pages.filter((p) => p.deliversBeat === false).map((p) => p.pageNumber),
    },
    passes: round.problems.length === 0,
  };

  const outJson = path.join(ROOT, '.screenshots/story-v2-proof-photo.json');
  writeFileSync(outJson, JSON.stringify({ summary, story, qc, pages, rounds }, null, 2));
  const md = [
    `# Story Quality V2 proof — PHOTO path (book ${book.id}) on ${STORY_MODEL}`,
    ``,
    `- Throughline: ${story.storyArc.throughline}`,
    `- Refrain: "${story.storyArc.refrain}" (${echoes} echoes)`,
    `- Verdict: **${summary.passes ? 'PASS' : 'FAIL'}**`,
    `- QC: arc ${qc.arcCoherence}/10, rhythm ${qc.readAloudRhythm}/10, agency ${qc.agency}/10, truthToEvent ${qc.truthToEvent ?? '—'}, landing ${qc.lastPageLanding}, maxCaptionRisk ${summary.qcScores.maxCaptionRisk}`,
    `- Words/page: ${summary.wordRange[0]}-${summary.wordRange[1]}, max sentences ${summary.maxSentences}`,
    ``,
    ...pages.map(
      (p) =>
        `**p${p.pageNumber}** [photo hint: ${p.arcRole} → beat: ${p.beat?.role}: ${p.beat?.goal}] (${p.words}w/${p.sentences}s, moodCue: ${p.moodCue ?? '—'})\n> ${p.text}\n`,
    ),
  ].join('\n');
  const outMd = path.join(ROOT, '.screenshots/story-v2-proof-photo.md');
  writeFileSync(outMd, md);

  console.log(JSON.stringify(summary, null, 2));
  console.log(`[proof-photo] wrote ${outJson} and ${outMd}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[proof-photo] FAILED:', err?.message || err);
  process.exit(1);
});
