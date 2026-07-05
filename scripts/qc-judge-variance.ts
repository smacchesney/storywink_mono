#!/usr/bin/env tsx
/**
 * QC judge variance baseline — owner-runnable, read-only.
 *
 * Re-runs the illustration QC call TWICE over the illustrated pages of the
 * given COMPLETED books and prints per-dimension score variance between the
 * two runs. The mean absolute run-to-run delta is the judge's noise floor:
 * any with/without-character-sheet comparison (hadSheet telemetry) is only
 * decision-grade when its observed delta clears this baseline. Run this on
 * ~10 books BEFORE treating sheet telemetry as a go/no-go signal.
 *
 * Usage:    npx tsx scripts/qc-judge-variance.ts <bookId> [bookId ...]
 * Requires: DATABASE_URL, OPENAI_API_KEY (optional ANALYSIS_MODEL override).
 *
 * Writes nothing to the database and sends nothing to re-render queues —
 * it only calls the vision judge and prints statistics.
 */

import { PrismaClient } from '@storywink/database';
import OpenAI from 'openai';
import {
  createQCPrompt,
  QC_SYSTEM_PROMPT,
  QC_RESPONSE_SCHEMA,
} from '@storywink/shared/prompts/quality-check';
import { optimizeCloudinaryUrlForVision } from '@storywink/shared/utils';
import type { CharacterIdentity } from '@storywink/shared/types';

const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'gpt-5-mini';

const prisma = new PrismaClient();

interface JudgePageResult {
  pageNumber: number;
  passed: boolean;
  characterConsistencyScore: number;
  styleConsistencyScore: number;
  overallScore: number;
  issues: string[];
  suggestedPromptAdditions: string | null;
}

interface JudgeResponse {
  passed: boolean;
  summary: string;
  pageResults: JudgePageResult[];
}

const DIMENSIONS = [
  ['char', 'characterConsistencyScore'],
  ['style', 'styleConsistencyScore'],
  ['overall', 'overallScore'],
] as const;

async function runJudgeOnce(
  openai: OpenAI,
  imageUrls: string[],
  characterIdentity: CharacterIdentity | null,
  language: string,
): Promise<JudgeResponse> {
  // Mirrors book-finalize.worker.ts exactly: "PAGE n" label before each image,
  // prompt after all images, strict json_schema output.
  const contentParts: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string; detail: 'high' }
  > = [];

  imageUrls.forEach((url, i) => {
    contentParts.push({ type: 'input_text', text: `PAGE ${i + 1}` });
    contentParts.push({
      type: 'input_image',
      image_url: optimizeCloudinaryUrlForVision(url),
      detail: 'high',
    });
  });

  contentParts.push({
    type: 'input_text',
    text: createQCPrompt(characterIdentity, imageUrls.length, language),
  });

  const result = await openai.responses.create({
    model: ANALYSIS_MODEL,
    instructions: QC_SYSTEM_PROMPT,
    input: [{ role: 'user', content: contentParts }],
    text: {
      format: {
        type: 'json_schema',
        name: 'qc_response',
        strict: true,
        schema: QC_RESPONSE_SCHEMA as Record<string, unknown>,
      },
    },
  });

  if (!result.output_text) throw new Error('Judge returned empty response');
  return JSON.parse(result.output_text) as JudgeResponse;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

function stddev(values: number[]): number {
  if (values.length < 2) return NaN;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
}

async function main() {
  const bookIds = process.argv.slice(2);
  if (bookIds.length === 0) {
    console.error('Usage: npx tsx scripts/qc-judge-variance.ts <bookId> [bookId ...]');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is required');
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Per-dimension run-to-run absolute deltas, pooled across all pages/books.
  const deltas: Record<string, number[]> = { char: [], style: [], overall: [] };
  let passFlips = 0;
  let pagesScored = 0;

  for (const bookId of bookIds) {
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: { pages: { orderBy: { pageNumber: 'asc' } } },
    });

    if (!book) {
      console.warn(`- ${bookId}: not found — skipping`);
      continue;
    }
    if (book.status !== 'COMPLETED') {
      console.warn(`- ${bookId}: status ${book.status} (expected COMPLETED) — skipping`);
      continue;
    }

    const imageUrls = book.pages
      .map((p) => p.generatedImageUrl)
      .filter((u): u is string => Boolean(u));

    if (imageUrls.length < 2) {
      console.warn(`- ${bookId}: fewer than 2 illustrated pages — skipping`);
      continue;
    }

    console.log(`\nBook ${bookId} ("${book.title}"), ${imageUrls.length} illustrated pages`);
    const identity = book.characterIdentity as CharacterIdentity | null;
    const language = book.language || 'en';

    const runA = await runJudgeOnce(openai, imageUrls, identity, language);
    const runB = await runJudgeOnce(openai, imageUrls, identity, language);

    const byEcho = (run: JudgeResponse) =>
      new Map(run.pageResults.map((r) => [r.pageNumber, r]));
    const mapA = byEcho(runA);
    const mapB = byEcho(runB);

    for (let ordinal = 1; ordinal <= imageUrls.length; ordinal++) {
      const a = mapA.get(ordinal);
      const b = mapB.get(ordinal);
      if (!a || !b) {
        console.warn(`  PAGE ${ordinal}: missing from a run (A: ${!!a}, B: ${!!b})`);
        continue;
      }
      pagesScored++;
      if (a.passed !== b.passed) passFlips++;

      const parts: string[] = [];
      for (const [label, key] of DIMENSIONS) {
        const d = Math.abs(a[key] - b[key]);
        deltas[label].push(d);
        parts.push(`${label} ${a[key]}→${b[key]} (|Δ|=${d})`);
      }
      parts.push(`passed ${a.passed}→${b.passed}`);
      console.log(`  PAGE ${ordinal}: ${parts.join(', ')}`);
    }
  }

  if (pagesScored === 0) {
    console.error('\nNo pages scored — nothing to report.');
    process.exit(1);
  }

  console.log(`\n${'='.repeat(64)}`);
  console.log(`Judge variance across ${pagesScored} pages (${bookIds.length} book(s), 2 runs each)`);
  console.log('='.repeat(64));
  for (const [label] of DIMENSIONS) {
    const ds = deltas[label];
    console.log(
      `  ${label.padEnd(8)} mean |Δ| = ${mean(ds).toFixed(2)}   sd(|Δ|) = ${stddev(ds).toFixed(2)}   max |Δ| = ${Math.max(...ds)}`,
    );
  }
  console.log(`  pass/fail verdict flips: ${passFlips}/${pagesScored}`);
  console.log(
    `\nMinimum detectable delta baseline: a with/without-sheet difference in mean`,
  );
  console.log(
    `scores smaller than the mean |Δ| above is judge noise, not signal — do not`,
  );
  console.log(`make sheet go/no-go decisions on differences below it.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
