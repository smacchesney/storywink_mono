/**
 * STORY QUALITY V2 proof run — regenerates the "Kai's Jungle Cannons" premise
 * through the NEW avatar prompt + schema, then judges it with the NEW QC v2
 * (deterministic checks + beat-aware gpt-5-mini judge, enforcement ON).
 *
 * Run from the monorepo root:
 *   npx tsx scripts/story-v2-proof.mts
 * Reads OPENAI_API_KEY (and optional STORY_MODEL) from apps/workers/.env.
 * Writes proof artifacts to .screenshots/story-v2-proof.{json,md}.
 */
import { config as dotenv } from 'dotenv';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import {
  createAvatarStoryPrompt,
  AVATAR_STORY_SYSTEM_PROMPT,
  STORY_RESPONSE_SCHEMA_AVATAR,
  type AvatarStoryResponse,
  type AvatarStoryGenerationInput,
} from '@storywink/shared/prompts/story';
import {
  createAvatarStoryQCPrompt,
  AVATAR_STORY_QC_SYSTEM_PROMPT,
  AVATAR_STORY_QC_RESPONSE_SCHEMA,
  type AvatarStoryQCResponse,
  countRefrainEchoes,
  countWords,
  countSentences,
} from '@storywink/shared/prompts/story-check';
import { deterministicStoryChecks } from '../apps/workers/src/lib/story-quality.js';
import { avatarStoryQcProblems } from '../apps/workers/src/lib/avatar-story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv({ path: path.join(ROOT, 'apps/workers/.env') });

const STORY_MODEL = process.env.STORY_MODEL || 'gpt-5.6';
const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'gpt-5-mini';

const input: AvatarStoryGenerationInput = {
  bookTitle: "Kai's Jungle Cannons",
  pageCount: 12,
  premise:
    "Kai and Dada follow Kai's crayon treasure map deep into the jungle with his toys — Trapjaw, Titan the titanoboa, and Trex — to find the old cliff cannons and free the pirate ship from a squeezing kraken.",
  cast: [
    { characterId: 'avatar_1', name: 'Kai', role: 'main_child' },
    { characterId: 'avatar_2', name: 'Dada', role: 'grown-up' },
    {
      characterId: 'avatar_3',
      name: 'Trapjaw',
      role: 'companion_object',
      description: 'blue action figure with a red helmet and a silver mechanical arm',
    },
    {
      characterId: 'avatar_4',
      name: 'Titan',
      role: 'companion_object',
      description: 'long green toy titanoboa snake',
    },
    {
      characterId: 'avatar_5',
      name: 'Trex',
      role: 'companion_object',
      description: 'gray toy tyrannosaurus with yellow eyes',
    },
  ],
  childName: 'Kai',
  language: 'en',
  suggestTitle: false,
  toysComeAlive: true,
};

async function main() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log(`[proof] generating with ${STORY_MODEL}…`);
  const started = Date.now();

  const promptParts = createAvatarStoryPrompt(input);
  const content = promptParts
    .filter((p): p is { text: string } => 'text' in p)
    .map((p) => ({ type: 'input_text' as const, text: p.text }));

  const result = await openai.responses.create({
    model: STORY_MODEL,
    instructions: AVATAR_STORY_SYSTEM_PROMPT,
    input: [{ role: 'user', content }],
    text: {
      format: {
        type: 'json_schema',
        name: 'story_response',
        strict: true,
        schema: STORY_RESPONSE_SCHEMA_AVATAR as unknown as Record<string, unknown>,
      },
    },
  });
  const genMs = Date.now() - started;
  if (!result.output_text) throw new Error('empty story response');
  const story = JSON.parse(result.output_text) as AvatarStoryResponse;

  const sorted = [...story.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const pageTexts = sorted.map((p) => p.text);
  const rosterNames = input.cast.map((c) => c.name);

  const det = deterministicStoryChecks(
    sorted.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
    rosterNames,
    'en',
  );
  const echoes = countRefrainEchoes(story.storyArc.refrain, pageTexts, 'en');

  console.log(`[proof] QC judge (${ANALYSIS_MODEL})…`);
  const qcResult = await openai.responses.create({
    model: ANALYSIS_MODEL,
    instructions: AVATAR_STORY_QC_SYSTEM_PROMPT,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: createAvatarStoryQCPrompt({
              storyArc: story.storyArc,
              pages: sorted.map((p) => ({
                pageNumber: p.pageNumber,
                text: p.text,
                sceneAction: p.scene?.action ?? null,
                sceneFocus: p.scene?.focus ?? null,
              })),
              language: 'en',
              premise: input.premise,
              cast: input.cast.map((c) => ({ name: c.name, role: c.role })),
              beatSheet: story.beatSheet,
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
        schema: AVATAR_STORY_QC_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
  });
  if (!qcResult.output_text) throw new Error('empty QC response');
  const qc = JSON.parse(qcResult.output_text) as AvatarStoryQCResponse;

  const problems = avatarStoryQcProblems(qc, story.storyArc.refrain, echoes, {
    enforce: true,
    deterministicProblems: det.problems,
    beatSheet: story.beatSheet,
  });

  const pages = sorted.map((p) => ({
    pageNumber: p.pageNumber,
    words: countWords(p.text),
    sentences: countSentences(p.text),
    beat: story.beatSheet.find((b) => b.pageNumber === p.pageNumber),
    text: p.text,
    sceneAction: p.scene?.action,
    mood: p.scene?.mood,
  }));

  const summary = {
    model: STORY_MODEL,
    genMs,
    throughline: story.storyArc.throughline,
    refrain: story.storyArc.refrain,
    refrainEchoes: echoes,
    beatRoles: story.beatSheet.map((b) => `${b.pageNumber}:${b.role}`),
    wordRange: [Math.min(...pages.map((p) => p.words)), Math.max(...pages.map((p) => p.words))],
    maxSentences: Math.max(...pages.map((p) => p.sentences)),
    deterministicProblems: det.problems,
    garbles: det.garbles,
    rollCall: det.rollCall,
    qcScores: {
      arcCoherence: qc.arcCoherence,
      readAloudRhythm: qc.readAloudRhythm,
      lastPageLanding: qc.lastPageLanding,
      premiseTruth: qc.premiseTruth,
      agency: qc.agency,
      deliversBeatFalse: qc.pages.filter((p) => p.deliversBeat === false).map((p) => p.pageNumber),
      sceneMismatch: qc.pages.filter((p) => p.sceneMatchesText === false).map((p) => p.pageNumber),
    },
    enforcedProblems: problems,
    verdict: problems.length === 0 ? 'PASS' : 'FAIL',
  };

  const outJson = path.join(ROOT, '.screenshots/story-v2-proof.json');
  writeFileSync(outJson, JSON.stringify({ summary, story, qc, pages }, null, 2));

  const md = [
    `# Story Quality V2 proof — Kai premise on ${STORY_MODEL}`,
    ``,
    `- Throughline: ${story.storyArc.throughline}`,
    `- Refrain: "${story.storyArc.refrain}" (${echoes} echoes)`,
    `- Verdict: **${summary.verdict}** (${problems.length} enforced problems)`,
    `- QC: arc ${qc.arcCoherence}/10, rhythm ${qc.readAloudRhythm}/10, agency ${qc.agency}/10, premiseTruth ${qc.premiseTruth}/10, landing ${qc.lastPageLanding}`,
    `- Words/page: ${summary.wordRange[0]}-${summary.wordRange[1]}, max sentences ${summary.maxSentences}`,
    ``,
    ...pages.map(
      (p) =>
        `**p${p.pageNumber}** [${p.beat?.role}: ${p.beat?.goal}] (${p.words}w/${p.sentences}s, mood: ${p.mood ?? '—'})\n> ${p.text}\n> _scene: ${p.sceneAction ?? '—'}_\n`,
    ),
  ].join('\n');
  const outMd = path.join(ROOT, '.screenshots/story-v2-proof.md');
  writeFileSync(outMd, md);

  console.log(JSON.stringify(summary, null, 2));
  console.log(`[proof] wrote ${outJson} and ${outMd}`);
}

main().catch((err) => {
  console.error('[proof] FAILED:', err?.message || err);
  process.exit(1);
});
