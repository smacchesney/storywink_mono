#!/usr/bin/env tsx
/**
 * X12 Track C — QC rubric-v2 proof harness (owner-runnable, READ-ONLY DB).
 *
 * Runs the SHIPPED QC machinery (isolated cover call + page batches + rubric v2
 * + the real gpt-5-mini judge) against the EXISTING generated images of a
 * production book, to prove the Track C fixes catch the book's known defects
 * and that error paths surface visible sentinels — WITHOUT re-rendering anything
 * and WITHOUT writing a single row.
 *
 * It FAITHFULLY MIRRORS book-finalize.worker.ts's runQualityCheck: the same
 * sheet-parts ground truth, the same isolated cover call, the same
 * partitionQcPages -> runQcBatches -> scoreBatch (expectedCastForPage +
 * heldPropsForPage + createQCPrompt v2 + callQcJudge + mapQcResultsToPages)
 * pipeline, and the same buildQcRows persist shape. The ONLY differences:
 *   - buildQcRows is captured, NEVER written (dry run).
 *   - one EXTRA forced-error batch (deliberately invalid model id) demonstrates
 *     the sentinel path end-to-end.
 * The DB is touched with findUnique/findMany ONLY.
 *
 * Usage (via `railway run --service workers` for prod DB + OPENAI_API_KEY):
 *   npx tsx scripts/x12-qc-proof.mts inspect
 *       Read-only. ZERO judge calls. Dumps the book's pages, cover, sheet
 *       ground truth, per-page expected cast + held props, and the batch
 *       partition plan so the content->pageNumber mapping is verified BEFORE
 *       any spend.
 *   npx tsx scripts/x12-qc-proof.mts run
 *       The judge run: isolated cover call + page batches + ONE forced-error
 *       batch (<=6 gpt-5-mini calls total). Dry-runs buildQcRows and writes the
 *       verdict table to .screenshots/x12-c-qc-proof.md + raw JSON to
 *       .screenshots/x12-c-qc-proof.json. NO DB writes.
 *
 * Every judge call is counted (countedJudge) and the total printed at exit.
 */

// Workers' ESM prisma singleton — proven in prod, clean default export.
// Read-only use only (findUnique/findMany).
import prisma from '../apps/workers/src/database/index.js';
import OpenAI from 'openai';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import {
  createQCPrompt,
  QC_SYSTEM_PROMPT,
  QC_RESPONSE_SCHEMA,
  type QcClass,
} from '@storywink/shared/prompts/quality-check';
import { optimizeCloudinaryUrlForVision, resolveCoverPage } from '@storywink/shared/utils';
import type {
  CharacterIdentity,
  CharacterSheetRef,
  CoverQCResult,
  PageQCResult,
} from '@storywink/shared/types';

import { ANALYSIS_MODEL } from '../apps/workers/src/config/models.js';
import { mergeLinkedAvatarSheets } from '../apps/workers/src/lib/avatar-sheets.js';
import { mapQcResultsToPages, type RawQcPageResult } from '../apps/workers/src/lib/qc-mapping.js';
import {
  partitionQcPages,
  runQcBatches,
  selectRequeuePageIds,
  isQcErrorFeedback,
  sentinelCoverResult,
  buildQcRows,
  type QcBatchOutcome,
  type QcRenderMeta,
  type QcResultRow,
} from '../apps/workers/src/lib/qc-batching.js';
import {
  assembleQcBatchParts,
  expectedCastForPage,
  heldPropsForPage,
} from '../apps/workers/src/lib/qc-assembly.js';
import pino from 'pino';

const BOOK_ID = 'cmrm0yfzd00ymo50dvcnetv1m'; // "Kai and the Wild Rumble", AVATAR_STORY

const SCREENSHOTS = path.resolve(process.cwd(), '.screenshots');
const MD_OUT = path.join(SCREENSHOTS, 'x12-c-qc-proof.md');
const JSON_OUT = path.join(SCREENSHOTS, 'x12-c-qc-proof.json');

// gpt-5-mini public list price (USD per 1M tokens) — labeled assumption; the
// hard data is the exact token counts the SDK returns. Override to re-cost.
const RATE_INPUT_PER_M = Number(process.env.QC_RATE_INPUT_PER_M ?? '0.25');
const RATE_OUTPUT_PER_M = Number(process.env.QC_RATE_OUTPUT_PER_M ?? '2.0');

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

// ---- expected-signal map (from the brief; content-confirmed via `inspect`) --
// pdf page ref = 2*pageNumber + 2. The shipped defect taxonomy, keyed by DB
// pageNumber, with the rubric-v2 class each SHOULD fire.
const EXPECTED: Record<number, { pdf: number; defect: string; class: QcClass | null }> = {
  3: { pdf: 8, defect: 'scaffold-caption (rendered text)', class: 'renderedText' },
  4: { pdf: 10, defect: 'double-Kai (same child twice)', class: 'intraImageDuplicate' },
  5: { pdf: 12, defect: 'missing named cast', class: 'missingExpectedCast' },
  7: { pdf: 16, defect: 'missing named cast', class: 'missingExpectedCast' },
  8: { pdf: 18, defect: 'Grypho drawn as griffin (wrong species)', class: 'speciesMismatch' },
  10: { pdf: 22, defect: 'Trapjaw x T-Rex fusion (hybrid)', class: 'characterHybrid' },
};
// Onomatopoeia pages (sound words in art) → renderedText. Confirmed by content
// in `inspect` against page text; recorded as data even where they overlap the
// map above.
const ONOMATOPOEIA_HINT = /\b(TIPTOE|DRIP|BOING|THUMP|SPLASH|WHEE|CRASH|BONK|ZOOM|POP)\b/i;

// Worker-faithful helpers now come from the SHARED assembly module
// (apps/workers/src/lib/qc-assembly.ts) — the same code the worker's
// scoreBatch runs, so harness and production cannot drift.

// ---------------------------------------------------------------------------
// Judge plumbing — the single spend choke point + per-call measurement.
// ---------------------------------------------------------------------------
type CallRecord = {
  label: string;
  model: string;
  ms: number;
  ok: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  error?: string;
};
const callRecords: CallRecord[] = [];
let judgeCalls = 0;

type ContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail: 'high' };

/**
 * The single place a real OpenAI QC call is made — counted, timed, usage
 * captured. `model` is a parameter ONLY so the forced-error demo can point one
 * call at an invalid id; every real call uses ANALYSIS_MODEL, exactly like the
 * worker. Throws on empty/failed response (an infra failure, not a pass).
 */
async function countedJudge(
  openai: OpenAI,
  label: string,
  contentParts: ContentPart[],
  model: string = ANALYSIS_MODEL,
): Promise<{
  passed: boolean;
  summary: string;
  coverResult?: CoverQCResult | null;
  pageResults: RawQcPageResult[];
}> {
  judgeCalls += 1;
  const rec: CallRecord = {
    label,
    model,
    ms: 0,
    ok: false,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  };
  const started = performance.now();
  console.log(`  [judge #${judgeCalls}] ${label} on ${model} (${contentParts.length} parts)`);
  try {
    const result = await openai.responses.create({
      model,
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
    rec.ms = Math.round(performance.now() - started);
    const usage = (result as unknown as { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }).usage;
    rec.inputTokens = usage?.input_tokens ?? null;
    rec.outputTokens = usage?.output_tokens ?? null;
    rec.totalTokens = usage?.total_tokens ?? null;
    const rawResult = result.output_text;
    if (!rawResult) throw new Error('OpenAI QC returned empty response');
    rec.ok = true;
    callRecords.push(rec);
    console.log(
      `    ok (${rec.ms} ms, in=${rec.inputTokens ?? '?'} out=${rec.outputTokens ?? '?'})`,
    );
    return JSON.parse(rawResult);
  } catch (err) {
    rec.ms = Math.round(performance.now() - started);
    rec.error = err instanceof Error ? err.message : String(err);
    callRecords.push(rec);
    console.log(`    ERROR (${rec.ms} ms): ${rec.error}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Read-only load — the same inputs runQualityCheck receives.
// ---------------------------------------------------------------------------
async function loadBook() {
  const book = await prisma.book.findUnique({
    where: { id: BOOK_ID },
    include: {
      pages: {
        orderBy: { pageNumber: 'asc' },
        select: {
          id: true,
          pageNumber: true,
          isTitlePage: true,
          source: true,
          text: true,
          bridgeScene: true,
          generatedImageUrl: true,
          assetId: true,
          lastRenderProvider: true,
          lastRenderModel: true,
          lastRenderHadSheet: true,
        },
      },
    },
  });
  if (!book) throw new Error('book not found');

  const characterIdentity = book.characterIdentity as unknown as CharacterIdentity | null;
  const language = book.language || 'en';

  // Sheet ground truth — mirrors the worker's AVATAR_STORY path: base [] +
  // linked account-avatar sheets. mergeLinkedAvatarSheets is read-only.
  const sheets: CharacterSheetRef[] =
    (await mergeLinkedAvatarSheets({
      bookId: BOOK_ID,
      userId: book.userId,
      artStyle: book.artStyle,
      bookType: book.bookType,
      base: [],
      logger,
    })) ?? [];

  // Judge sees the sheets ONLY if the judged renders actually had them
  // (lastRenderHadSheet). Faithful to runQualityCheck's sheetsForJudge.
  const anyRenderHadSheet = book.pages.some((p) => p.generatedImageUrl && p.lastRenderHadSheet);
  const sheetsForJudge = anyRenderHadSheet ? sheets : [];

  // AVATAR_STORY: cover joins QC unconditionally when coverImageUrl + title
  // exist, scored under the cover rubric variant.
  const coverForQc =
    (book.bookType === 'AVATAR_STORY') && book.coverImageUrl && book.title
      ? { url: book.coverImageUrl, expectedTitle: book.title }
      : null;

  // Mirror the worker's qcPages shape EXACTLY: it maps `pageId: p.id` before
  // handing pages to partitionQcPages/runQcBatches (which key on `.pageId`).
  // Passing raw Prisma rows (`.id`) would make runQcBatches miss every page and
  // emit undefined-pageId sentinels. isTitlePage is carried for display only —
  // it never reaches the judge.
  const qcPages = book.pages.map((p) => ({
    pageNumber: p.pageNumber,
    pageId: p.id,
    isTitlePage: p.isTitlePage,
    generatedImageUrl: p.generatedImageUrl,
    source: p.source as string | null,
    text: p.text,
    bridgeScene: p.bridgeScene,
  }));
  const illustratedPages = qcPages.filter((p) => p.generatedImageUrl);

  return {
    book,
    characterIdentity,
    language,
    sheets,
    sheetsForJudge,
    anyRenderHadSheet,
    coverForQc,
    illustratedPages,
  };
}

type Loaded = Awaited<ReturnType<typeof loadBook>>;
type IllPage = Loaded['illustratedPages'][number];

/** Build the "REFERENCE SHEET" content parts prepended to every call. */
function sheetPartsFor(sheets: CharacterSheetRef[]): ContentPart[] {
  const parts: ContentPart[] = [];
  for (const sheet of sheets) {
    parts.push({ type: 'input_text', text: `REFERENCE SHEET — ${sheet.name || sheet.characterId}` });
    parts.push({
      type: 'input_image',
      image_url: optimizeCloudinaryUrlForVision(sheet.url),
      detail: 'high',
    });
  }
  return parts;
}

// ---------------------------------------------------------------------------
// INSPECT — zero judge calls. Validates setup + content->pageNumber mapping.
// ---------------------------------------------------------------------------
async function inspect() {
  console.log('=== INSPECT (read-only, ZERO judge calls) ===');
  const ctx = await loadBook();
  const { book, characterIdentity, language, sheets, sheetsForJudge, coverForQc } = ctx;

  console.log(`Book: "${book.title}"  type=${book.bookType}  lang=${language}`);
  console.log(`coverImageUrl present: ${Boolean(book.coverImageUrl)}  title="${book.title}"`);
  console.log(
    `sheets(all)=${sheets.length} [${sheets.map((s) => `${s.characterId}:${s.name}`).join(', ')}]`,
  );
  console.log(`anyRenderHadSheet=${ctx.anyRenderHadSheet} -> sheetsForJudge=${sheetsForJudge.length}`);
  console.log(
    `roster: ${(characterIdentity?.characters ?? [])
      .map((c) => `${c.name || c.characterId}(${c.role})`)
      .join(', ')}`,
  );
  console.log(`illustrated pages: ${ctx.illustratedPages.length}`);

  const batches = partitionQcPages(ctx.illustratedPages);
  console.log(
    `batch plan: ${batches.length} batch(es) of [${batches.map((b) => b.length).join(', ')}]  (cover call is separate)`,
  );
  console.log(
    `projected judge calls for run: 1 cover + ${batches.length} batch + 1 forced = ${batches.length + 2}`,
  );

  console.log('\nPer-page context fed to the judge:');
  for (const p of ctx.illustratedPages) {
    const cast = expectedCastForPage(characterIdentity, p);
    const props = heldPropsForPage(p);
    const exp = EXPECTED[p.pageNumber];
    const ono = p.text && ONOMATOPOEIA_HINT.test(p.text) ? ' [ONOMATOPOEIA]' : '';
    console.log(
      `  p${p.pageNumber}${p.isTitlePage ? '(title)' : ''} pdf~${2 * p.pageNumber + 2} src=${p.source} ${exp ? `EXPECT:${exp.class}` : ''}${ono}`,
    );
    console.log(`     text: ${JSON.stringify((p.text || '').slice(0, 90))}`);
    console.log(`     cast: [${cast.map((c) => `${c.name}=${c.species}`).join(' | ')}]`);
    if (props.length) console.log(`     props: ${props.join('; ')}`);
  }
  console.log(`\nINSPECT done. judge calls: ${judgeCalls} (must be 0).`);
}

// ---------------------------------------------------------------------------
// RUN — the judge run + dry-run persistence + forced-error sentinel demo.
// ---------------------------------------------------------------------------
async function run() {
  console.log('=== RUN (real gpt-5-mini judge; NO DB writes) ===');
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
  const ctx = await loadBook();
  const { book, characterIdentity, language, sheetsForJudge, coverForQc, illustratedPages } = ctx;

  if (illustratedPages.length < 2) throw new Error('fewer than 2 illustrated pages — QC would skip');

  const batches = partitionQcPages(illustratedPages);
  // Spend guard: 1 cover + N batches + 1 forced must stay <= 6.
  if (batches.length + 2 > 6) {
    throw new Error(`batch plan ${batches.length} would exceed the 6-call ceiling — aborting`);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const sheetParts = sheetPartsFor(sheetsForJudge);

  // --- COVER: isolated scoring call (mirrors runQualityCheck) --------------
  let coverResult: CoverQCResult | null = null;
  if (coverForQc) {
    try {
      const parts: ContentPart[] = [...sheetParts];
      parts.push({ type: 'input_text', text: 'COVER' });
      parts.push({
        type: 'input_image',
        image_url: optimizeCloudinaryUrlForVision(coverForQc.url),
        detail: 'high',
      });
      parts.push({
        type: 'input_text',
        text: createQCPrompt(characterIdentity, 0, language, {
          sheetCount: sheetsForJudge.length,
          cover: { expectedTitle: coverForQc.expectedTitle },
        }),
      });
      const parsed = await countedJudge(openai, 'cover', parts);
      coverResult = parsed.coverResult ?? sentinelCoverResult('no cover result returned');
    } catch (err) {
      coverResult = sentinelCoverResult(err instanceof Error ? err.message : 'Unknown error');
    }
    console.log(
      `  cover verdict: passed=${coverResult.passed} titleMatches=${coverResult.titleMatches}`,
    );
  }

  // --- PAGE BATCHES via runQcBatches (mirrors runQualityCheck) -------------
  const scoreBatch = async (batch: IllPage[], batchIndex: number): Promise<QcBatchOutcome> => {
    // The SAME tested assembly the worker's scoreBatch runs (qc-assembly.ts):
    // batch-local PAGE-n ordinals, batch-local pageCount, per-page context feed.
    const assembly = assembleQcBatchParts({
      batch,
      characterIdentity,
      language,
      sheetCount: sheetsForJudge.length,
    });
    const parts: ContentPart[] = [...sheetParts, ...assembly.contentParts];

    const parsed = await countedJudge(openai, `batch${batchIndex}`, parts);
    const { mapped, unmatchedEchoes } = mapQcResultsToPages(
      parsed.pageResults,
      assembly.pageMapping,
    );
    if (unmatchedEchoes.length > 0) {
      console.log(`    batch ${batchIndex}: dropped unmatched echoes ${unmatchedEchoes.join(',')}`);
    }
    return { pageResults: mapped };
  };

  const { pageResults } = await runQcBatches(batches, scoreBatch, (log) => {
    console.log(
      `  batch ${log.batchIndex} (${log.pageCount} pages): ${log.ok ? 'ok' : `error — ${log.error}`}`,
    );
  });

  const requeuePageIds = selectRequeuePageIds(pageResults);
  const requeueSet = new Set(requeuePageIds);

  // --- DRY-RUN persistence: what buildQcRows WOULD write (never written) ----
  const renderMetaByPageId = new Map<string, QcRenderMeta>(
    book.pages.map((p) => [
      p.id,
      {
        provider: p.lastRenderProvider ?? null,
        model: p.lastRenderModel ?? null,
        hadSheet: p.lastRenderHadSheet ?? false,
      },
    ]),
  );
  const titlePage = resolveCoverPage(
    book.pages as { assetId: string | null; isTitlePage?: boolean }[],
    book.coverAssetId,
    book.bookType,
  ) as (IllPage & { lastRenderProvider?: string | null; lastRenderModel?: string | null; lastRenderHadSheet?: boolean }) | null;
  const dryRunRows: QcResultRow[] = buildQcRows({
    bookId: BOOK_ID,
    qcRound: 0,
    pageResults,
    renderMetaByPageId,
    coverResult: coverForQc ? coverResult : null,
    coverMeta: {
      provider: titlePage?.lastRenderProvider ?? null,
      model: titlePage?.lastRenderModel ?? null,
      hadSheet: titlePage?.lastRenderHadSheet ?? false,
    },
  });

  // --- FORCED-ERROR demo: ONE batch call at an invalid model id ------------
  // A real SDK error (model not found) flows through runQcBatches's isolation:
  // the throw is caught and each page becomes a qc_error sentinel. Then
  // buildQcRows -> NULL scores + qc_error prefix, and selectRequeuePageIds
  // excludes them. Uses a 2-page batch to keep the doomed payload tiny.
  const forcedBatch = illustratedPages.slice(0, 2).map((p) => ({
    pageNumber: p.pageNumber,
    pageId: p.pageId,
    isTitlePage: p.isTitlePage,
    generatedImageUrl: p.generatedImageUrl,
    source: p.source,
    text: p.text,
    bridgeScene: p.bridgeScene,
  })) as IllPage[];
  const BAD_MODEL = 'gpt-5-mini-x12c-does-not-exist';
  const forcedScore = async (batch: IllPage[], batchIndex: number): Promise<QcBatchOutcome> => {
    // Minimal text-only payload — the invalid model rejects before inference,
    // so re-sending images would be wasted bandwidth on a doomed call.
    const parts: ContentPart[] = [
      { type: 'input_text', text: 'FORCED-ERROR PROBE — this call is expected to fail.' },
    ];
    const parsed = await countedJudge(openai, `forced-error-batch${batchIndex}`, parts, BAD_MODEL);
    const { mapped } = mapQcResultsToPages(parsed.pageResults, batch.map((b) => ({ pageNumber: b.pageNumber, pageId: b.pageId })));
    return { pageResults: mapped };
  };
  const forced = await runQcBatches([forcedBatch], forcedScore, (log) => {
    console.log(`  forced-error batch: ${log.ok ? 'ok (UNEXPECTED)' : `error — ${log.error}`}`);
  });
  const forcedRows = buildQcRows({
    bookId: BOOK_ID,
    qcRound: 0,
    pageResults: forced.pageResults,
    renderMetaByPageId,
    coverResult: null,
    coverMeta: { provider: null, model: null, hadSheet: false },
  });
  const forcedRequeue = selectRequeuePageIds(forced.pageResults);

  // --- spend/cost ----------------------------------------------------------
  const okCalls = callRecords.filter((c) => c.ok);
  const inTok = okCalls.reduce((a, c) => a + (c.inputTokens ?? 0), 0);
  const outTok = okCalls.reduce((a, c) => a + (c.outputTokens ?? 0), 0);
  const estCostUsd = (inTok / 1_000_000) * RATE_INPUT_PER_M + (outTok / 1_000_000) * RATE_OUTPUT_PER_M;
  // Real per-book QC cost = the REAL calls only (cover + batches), excluding the
  // forced-error probe which a real finalize never makes.
  const realCalls = okCalls.filter((c) => !c.label.startsWith('forced-error'));
  const realIn = realCalls.reduce((a, c) => a + (c.inputTokens ?? 0), 0);
  const realOut = realCalls.reduce((a, c) => a + (c.outputTokens ?? 0), 0);
  const realCostUsd = (realIn / 1_000_000) * RATE_INPUT_PER_M + (realOut / 1_000_000) * RATE_OUTPUT_PER_M;

  // --- assemble the record + write outputs ---------------------------------
  const pageOut = illustratedPages.map((p) => {
    const r = pageResults.find((pr) => pr.pageId === p.pageId) ?? null;
    const exp = EXPECTED[p.pageNumber];
    return {
      pageNumber: p.pageNumber,
      isTitlePage: p.isTitlePage,
      source: p.source,
      textSnippet: (p.text || '').slice(0, 100),
      expectedCast: expectedCastForPage(characterIdentity, p),
      expected: exp ?? null,
      onomatopoeia: Boolean(p.text && ONOMATOPOEIA_HINT.test(p.text)),
      result: r,
      requeued: r ? requeueSet.has(r.pageId) : false,
    };
  });

  const record = {
    bookId: BOOK_ID,
    title: book.title,
    bookType: book.bookType,
    model: ANALYSIS_MODEL,
    generatedAt: new Date().toISOString(),
    spend: {
      judgeCalls,
      calls: callRecords,
      okTokens: { input: inTok, output: outTok, total: inTok + outTok },
      rate: { inputPerM: RATE_INPUT_PER_M, outputPerM: RATE_OUTPUT_PER_M, note: 'assumed gpt-5-mini public list price' },
      estCostAllCallsUsd: Number(estCostUsd.toFixed(5)),
      realPerBookQc: {
        calls: realCalls.length,
        input: realIn,
        output: realOut,
        estCostUsd: Number(realCostUsd.toFixed(5)),
        note: 'cover + page batches only (excludes forced-error probe)',
      },
    },
    cover: coverForQc
      ? { present: true, expectedTitle: coverForQc.expectedTitle, result: coverResult }
      : { present: false },
    requeuePageIds,
    pages: pageOut,
    dryRunRows,
    forcedError: {
      badModel: BAD_MODEL,
      batch: forcedBatch.map((b) => ({ pageNumber: b.pageNumber, pageId: b.pageId })),
      sentinelResults: forced.pageResults,
      sentinelRows: forcedRows,
      requeueAfterSentinel: forcedRequeue,
    },
  };

  mkdirSync(SCREENSHOTS, { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify(record, null, 2));
  writeFileSync(MD_OUT, renderMarkdown(record));
  console.log(`\nSaved ${MD_OUT}`);
  console.log(`Saved ${JSON_OUT}`);
  console.log(`\nRUN done. judge calls: ${judgeCalls}. est cost (all): $${estCostUsd.toFixed(5)}.`);
}

// ---------------------------------------------------------------------------
function fmtClass(v: boolean | null): string {
  return v === true ? 'YES' : v === null ? '·' : '—';
}

function renderMarkdown(rec: ProofRecord): string {
  const lines: string[] = [];
  lines.push(`# X12-C QC rubric-v2 proof — ${rec.title}`);
  lines.push('');
  lines.push(`- Book: \`${rec.bookId}\` (${rec.bookType})`);
  lines.push(`- Judge model: \`${rec.model}\`  ·  generated ${rec.generatedAt}`);
  lines.push(`- Judge calls: **${rec.spend.judgeCalls}**  (${rec.spend.calls.filter((c) => c.ok).length} ok)`);
  lines.push(
    `- Real per-book QC cost: **$${rec.spend.realPerBookQc.estCostUsd}** over ${rec.spend.realPerBookQc.calls} call(s) ` +
      `(in ${rec.spend.realPerBookQc.input} / out ${rec.spend.realPerBookQc.output} tok) — ${rec.spend.rate.note}`,
  );
  lines.push('');

  // Cover
  lines.push('## Cover');
  if (rec.cover.present) {
    const c = rec.cover.result!;
    const errored = isQcErrorFeedback(c.suggestedPromptAdditions);
    lines.push(`Expected title: \`${rec.cover.expectedTitle}\``);
    lines.push('');
    lines.push('| passed | titleMatches | char | style | overall | feedback |');
    lines.push('|---|---|---|---|---|---|');
    lines.push(
      `| ${c.passed} | ${c.titleMatches} | ${errored ? '—' : c.characterConsistencyScore} | ${errored ? '—' : c.styleConsistencyScore} | ${errored ? '—' : c.overallScore} | ${(c.suggestedPromptAdditions || '').slice(0, 120).replace(/\|/g, '\\|')} |`,
    );
  } else {
    lines.push('_No cover in this QC run._');
  }
  lines.push('');

  // Pages
  lines.push('## Pages (dry-run verdicts)');
  lines.push('');
  lines.push(
    '| pg | pdf | expect | passed | char | style | ovr | rText | dup | missCast | species | hybrid | propH | focalA | requeue | feedback |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of rec.pages) {
    const r = p.result;
    if (!r) {
      lines.push(`| ${p.pageNumber} | ${p.expected?.pdf ?? ''} | ${p.expected?.class ?? ''} | (no result) | | | | | | | | | | | | |`);
      continue;
    }
    const f = r.classFlags;
    const errored = isQcErrorFeedback(r.suggestedPromptAdditions);
    lines.push(
      `| ${p.pageNumber}${p.isTitlePage ? 'T' : ''} | ${p.expected?.pdf ?? ''} | ${p.expected?.class ?? (p.onomatopoeia ? 'renderedText?' : '')} | ${errored ? 'ERR' : r.passed} | ` +
        `${errored ? '—' : r.characterConsistencyScore} | ${errored ? '—' : r.styleConsistencyScore} | ${errored ? '—' : r.overallScore} | ` +
        `${fmtClass(f.renderedText)} | ${fmtClass(f.intraImageDuplicate)} | ${fmtClass(f.missingExpectedCast)} | ${fmtClass(f.speciesMismatch)} | ${fmtClass(f.characterHybrid)} | ${fmtClass(f.propHolderMismatch)} | ${fmtClass(f.focalActionMismatch)} | ` +
        `${p.requeued ? 'REQUEUE' : '—'} | ${(r.suggestedPromptAdditions || '').slice(0, 90).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`,
    );
  }
  lines.push('');
  lines.push(`Requeue set (blocking classes only): ${rec.requeuePageIds.length} page(s).`);
  lines.push('');

  // Expected vs actual
  lines.push('## Expected vs actual (per defect class)');
  lines.push('');
  lines.push('| pg | defect | expected class | fired? | judge passed |');
  lines.push('|---|---|---|---|---|');
  for (const [pgStr, exp] of Object.entries(EXPECTED)) {
    const pg = Number(pgStr);
    const p = rec.pages.find((x) => x.pageNumber === pg);
    const r = p?.result;
    const fired = r && exp.class ? r.classFlags[exp.class] === true : false;
    lines.push(
      `| ${pg} | ${exp.defect} | ${exp.class} | ${fired ? '**CATCH**' : 'MISS'} | ${r ? r.passed : 'n/a'} |`,
    );
  }
  lines.push('');

  // Forced-error
  lines.push('## Forced-error sentinel demo');
  lines.push('');
  lines.push(`Invalid model id: \`${rec.forcedError.badModel}\` → one real SDK failure, caught by runQcBatches.`);
  lines.push('');
  lines.push('| pageId | passed | charScore | styleScore | overallScore | feedback prefix |');
  lines.push('|---|---|---|---|---|---|');
  for (const row of rec.forcedError.sentinelRows) {
    lines.push(
      `| ${row.pageId} | ${row.passed} | ${row.charScore === null ? 'NULL' : row.charScore} | ${row.styleScore === null ? 'NULL' : row.styleScore} | ${row.overallScore === null ? 'NULL' : row.overallScore} | ${(row.feedback || '').slice(0, 60)} |`,
    );
  }
  lines.push('');
  lines.push(
    `Requeue selector over the sentinel rows: **${rec.forcedError.requeueAfterSentinel.length === 0 ? 'EXCLUDED (empty)' : rec.forcedError.requeueAfterSentinel.join(', ')}** — an outage never requeues.`,
  );
  lines.push('');
  lines.push('## Per-call latency + tokens');
  lines.push('');
  lines.push('| call | model | ms | in tok | out tok | ok |');
  lines.push('|---|---|---|---|---|---|');
  for (const c of rec.spend.calls) {
    lines.push(
      `| ${c.label} | ${c.model} | ${c.ms} | ${c.inputTokens ?? '?'} | ${c.outputTokens ?? '?'} | ${c.ok} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
// Shape of the assembled proof record (written to JSON, rendered to markdown).
interface ProofRecord {
  bookId: string;
  title: string | null;
  bookType: string | null;
  model: string;
  generatedAt: string;
  spend: {
    judgeCalls: number;
    calls: CallRecord[];
    okTokens: { input: number; output: number; total: number };
    rate: { inputPerM: number; outputPerM: number; note: string };
    estCostAllCallsUsd: number;
    realPerBookQc: { calls: number; input: number; output: number; estCostUsd: number; note: string };
  };
  cover: { present: boolean; expectedTitle?: string; result?: CoverQCResult | null };
  requeuePageIds: string[];
  pages: Array<{
    pageNumber: number;
    isTitlePage: boolean;
    source: string | null;
    textSnippet: string;
    expectedCast: Array<{ name: string; species: string }>;
    expected: { pdf: number; defect: string; class: QcClass | null } | null;
    onomatopoeia: boolean;
    result: PageQCResult | null;
    requeued: boolean;
  }>;
  dryRunRows: QcResultRow[];
  forcedError: {
    badModel: string;
    batch: Array<{ pageNumber: number; pageId: string }>;
    sentinelResults: PageQCResult[];
    sentinelRows: QcResultRow[];
    requeueAfterSentinel: string[];
  };
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'inspect') await inspect();
  else if (mode === 'run') await run();
  else {
    console.error('Usage: x12-qc-proof.mts <inspect | run>');
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n[SPEND] total judge calls: ${judgeCalls}`);
  });
