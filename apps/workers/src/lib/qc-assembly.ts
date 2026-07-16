import type { CharacterIdentity } from '@storywink/shared/types';
import { createQCPrompt, type QcPageContext } from '@storywink/shared/prompts/quality-check';
import { speciesLineFor, kindFromRole } from '@storywink/shared/prompts/character-identity';
import { isMainCharacterRole } from '@storywink/shared/prompts/illustration';
import { optimizeCloudinaryUrlForVision } from '@storywink/shared/utils';
import type { QcClassFlagFeed } from './qc-batching.js';

/**
 * QC batch ASSEMBLY — the pure seam between "which pages are in this batch"
 * and "what the judge is sent". book-finalize.worker.ts's scoreBatch and the
 * owner-runnable proof harness (scripts/x12-qc-proof.mts) BOTH import from
 * here, so the prompt the harness proves is byte-identical to the prompt the
 * worker ships; a divergence is a compile error, not silent drift.
 *
 * Everything here is pure over its inputs (no SDK, no DB) so the assembled
 * level — ordinal restart per batch, batch-local pageCount, context-feed
 * alignment — is unit-testable.
 */

/** One content part of a QC vision call (OpenAI Responses input shape). */
export type QcContentPart =
  { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'high' };

/** The page fields batch assembly reads. */
export interface QcAssemblyPage {
  pageNumber: number;
  pageId: string;
  generatedImageUrl: string | null;
  /** Page.source — 'BRIDGE' rows get the bridge-specific QC rubric lines. */
  source?: string | null;
  /** Page story text (the overlay copy) — fed for focal-action scoring. */
  text?: string | null;
  /** Page.bridgeScene JSON — source of the scene cast + holder-annotated props. */
  bridgeScene?: unknown;
}

/** Prop strings whose text names WHO holds the prop can be judged for holder match. */
const HOLDER_PHRASE = /\bheld by\b|\bcarried by\b|\bholds\b|\bholding\b/i;

/**
 * The cast the QC judge should expect on a page — the SAME filter the render
 * prompt's identity section uses (main role OR appears on this page OR appears
 * everywhere), with bridge pages honoring the story-authored scene cast. Each
 * entry pairs the REAL name with the SAME species/kind phrase the render fed
 * (`speciesLineFor`), so the judge can flag a missing or wrong-species figure.
 * Feeds the TELEMETRY-only exact-cast + species classes, so a loose match is
 * acceptable — it is never a blocking gate.
 */
export function expectedCastForPage(
  characterIdentity: CharacterIdentity | null,
  page: { pageNumber: number; source?: string | null; bridgeScene?: unknown },
): Array<{ name: string; species: string }> {
  const chars = characterIdentity?.characters ?? [];
  if (chars.length === 0) return [];

  const bridgeIds =
    page.source === 'BRIDGE' && page.bridgeScene && typeof page.bridgeScene === 'object'
      ? ((page.bridgeScene as { charactersPresent?: unknown }).charactersPresent as
          string[] | undefined)
      : undefined;
  const bridgeFiltered = bridgeIds?.length
    ? chars.filter((c) => bridgeIds.includes(c.characterId))
    : [];

  const relevant = bridgeFiltered.length
    ? bridgeFiltered
    : chars.filter(
        (c) =>
          isMainCharacterRole(c.role) ||
          c.appearsOnPages.includes(page.pageNumber) ||
          c.appearsOnPages.length === 0,
      );

  return relevant.map((c) => ({
    name: c.name || c.characterId,
    species: speciesLineFor(c, kindFromRole(c.role)),
  }));
}

/**
 * Props whose text names WHO holds them — the only props the prop-holder class
 * can judge. Today most props carry no holder phrasing (Track B will enrich
 * them), so this is usually empty and the class stays a no-op.
 */
export function heldPropsForPage(page: { bridgeScene?: unknown }): string[] {
  const scene = page.bridgeScene;
  if (!scene || typeof scene !== 'object') return [];
  const props = (scene as { props?: unknown }).props;
  if (!Array.isArray(props)) return [];
  return props.filter((p): p is string => typeof p === 'string' && HOLDER_PHRASE.test(p));
}

/**
 * X13 Track L: the story-authored mood + composition focus for a page. Present
 * only on avatar scenes (photo/bridge scenes never carry them), so this
 * degrades to null/null and the moodMismatch class stays a no-op elsewhere.
 */
export function sceneMeaningForPage(page: { bridgeScene?: unknown }): {
  mood: string | null;
  focus: string | null;
} {
  const scene = page.bridgeScene;
  if (!scene || typeof scene !== 'object') return { mood: null, focus: null };
  const s = scene as { mood?: unknown; focus?: unknown };
  return {
    mood: typeof s.mood === 'string' && s.mood.trim() ? s.mood : null,
    focus: typeof s.focus === 'string' && s.focus.trim() ? s.focus : null,
  };
}

/**
 * One page's judge feed (text + expected cast + held props) — used for both
 * the per-page prompt context (with an ordinal, in `assembleQcBatchParts`) and
 * the `qc_class_flags` telemetry record, so the telemetry always describes
 * exactly what the judge was fed.
 */
export function pageFeedFor(
  characterIdentity: CharacterIdentity | null,
  page: QcAssemblyPage,
): QcClassFlagFeed {
  const { mood, focus } = sceneMeaningForPage(page);
  return {
    text: page.text ?? null,
    cast: expectedCastForPage(characterIdentity, page),
    props: heldPropsForPage(page),
    mood,
    focus,
  };
}

/** Everything one batch's judge call needs, plus the echo-mapping table. */
export interface QcBatchAssembly {
  /**
   * "PAGE n" labels + page images + the trailing rubric prompt, in send order.
   * The caller prepends the REFERENCE SHEET parts (shared across batches).
   */
  contentParts: QcContentPart[];
  /**
   * Presentation-ordinal → DB page table for `mapQcResultsToPages`: index i
   * holds the page labeled "PAGE i+1" in THIS batch.
   */
  pageMapping: Array<{ pageNumber: number; pageId: string }>;
  /** The per-page context fed into the prompt (exposed for tests/telemetry). */
  pageContext: QcPageContext[];
  /** Batch-local ordinals of BRIDGE pages. */
  bridgePageOrdinals: number[];
  /** The assembled rubric prompt (last content part) — exposed for tests. */
  promptText: string;
}

/**
 * Assemble one batch's judge call. Per-batch "PAGE n" ordinals restart at 1 —
 * the judge's echo indexes THIS batch's local pageMapping, not a book-wide
 * position — and the prompt's pageCount is batch-local for the same reason.
 * BRIDGE ordinals and the per-page context feed are likewise batch-local.
 *
 * The context feed carries REAL character names + species; that is intentional
 * (the judge scores appearance against the sheets) and unrelated to the OpenAI
 * renderer's name-neutralization, which never reaches this evaluation payload.
 */
export function assembleQcBatchParts(params: {
  batch: QcAssemblyPage[];
  characterIdentity: CharacterIdentity | null;
  language: string;
  sheetCount: number;
}): QcBatchAssembly {
  const { batch, characterIdentity, language, sheetCount } = params;

  const contentParts: QcContentPart[] = [];
  const pageMapping: Array<{ pageNumber: number; pageId: string }> = [];
  const bridgePageOrdinals: number[] = [];
  const pageContext: QcPageContext[] = [];

  for (const page of batch) {
    if (!page.generatedImageUrl) {
      // Callers batch illustrated pages only; a null here is a filtering bug
      // upstream, and sending a batch with a phantom label would shift every
      // later ordinal off its image.
      throw new Error(
        `assembleQcBatchParts: page ${page.pageNumber} (${page.pageId}) has no generatedImageUrl`,
      );
    }
    const ordinal = pageMapping.length + 1;
    contentParts.push({ type: 'input_text', text: `PAGE ${ordinal}` });
    contentParts.push({
      type: 'input_image',
      image_url: optimizeCloudinaryUrlForVision(page.generatedImageUrl),
      detail: 'high',
    });
    if (page.source === 'BRIDGE') bridgePageOrdinals.push(ordinal);
    pageContext.push({ ordinal, ...pageFeedFor(characterIdentity, page) });
    pageMapping.push({ pageNumber: page.pageNumber, pageId: page.pageId });
  }

  const promptText = createQCPrompt(characterIdentity, pageMapping.length, language, {
    sheetCount,
    // Books without BRIDGE rows yield an empty list and a byte-identical
    // prompt, so the flag-off default is untouched.
    ...(bridgePageOrdinals.length ? { bridgePageOrdinals } : {}),
    ...(pageContext.length ? { pageContext } : {}),
  });
  contentParts.push({ type: 'input_text', text: promptText });

  return { contentParts, pageMapping, pageContext, bridgePageOrdinals, promptText };
}
