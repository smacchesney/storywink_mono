import type { PageQCResult, QcClassFlags } from '@storywink/shared/types';
import { emptyQcClassFlags } from '@storywink/shared/prompts/quality-check';

/** One entry per illustrated image sent to the QC judge, in presentation order. */
export interface QcPageRef {
  /** DB pageNumber of the page behind this image. */
  pageNumber: number;
  pageId: string;
}

/** Shape of one pageResults entry as returned by the QC judge (QC_RESPONSE_SCHEMA). */
export interface RawQcPageResult {
  pageNumber: number;
  passed: boolean;
  characterConsistencyScore: number;
  styleConsistencyScore: number;
  overallScore: number;
  issues: string[];
  suggestedPromptAdditions: string | null;
  /**
   * Rubric-v2 defect classes. Strict mode guarantees the judge returns these,
   * but a pre-schema echo (or a partial payload) is normalized against the
   * all-clean default so a missing class never reads as a defect.
   */
  classFlags?: Partial<QcClassFlags> | null;
}

/** Coerce a raw judge classFlags blob onto the strict QcClassFlags shape. */
function normalizeClassFlags(raw: Partial<QcClassFlags> | null | undefined): QcClassFlags {
  const base = emptyQcClassFlags();
  if (!raw) return base;
  return {
    renderedText: raw.renderedText ?? base.renderedText,
    intraImageDuplicate: raw.intraImageDuplicate ?? base.intraImageDuplicate,
    missingExpectedCast: raw.missingExpectedCast ?? base.missingExpectedCast,
    speciesMismatch: raw.speciesMismatch ?? base.speciesMismatch,
    characterHybrid: raw.characterHybrid ?? base.characterHybrid,
    // Nullable no-op classes: honor an explicit null/boolean, else default null.
    propHolderMismatch: raw.propHolderMismatch ?? base.propHolderMismatch,
    focalActionMismatch: raw.focalActionMismatch ?? base.focalActionMismatch,
  };
}

export interface QcMappingResult {
  mapped: PageQCResult[];
  /** Echoed numbers that matched no image label — dropped, caller should log. */
  unmatchedEchoes: number[];
}

/**
 * Maps the QC judge's page results back to DB pages.
 *
 * The judge echoes the 1-based presentation ordinal from the "PAGE n" labels
 * that precede each image — NOT the DB pageNumber. The two diverge whenever a
 * page without an illustration was skipped from the QC input, so the echo is
 * used as an index into pageMapping (built in presentation order), never
 * matched against Page.pageNumber. This also survives the judge reordering
 * its results.
 */
export function mapQcResultsToPages(
  pageResults: RawQcPageResult[],
  pageMapping: QcPageRef[],
): QcMappingResult {
  const mapped: PageQCResult[] = [];
  const unmatchedEchoes: number[] = [];

  for (const pr of pageResults) {
    const ref = Number.isInteger(pr.pageNumber) ? pageMapping[pr.pageNumber - 1] : undefined;

    if (!ref) {
      unmatchedEchoes.push(pr.pageNumber);
      continue;
    }

    mapped.push({
      pageNumber: ref.pageNumber,
      pageId: ref.pageId,
      passed: pr.passed,
      issues: pr.issues,
      characterConsistencyScore: pr.characterConsistencyScore,
      styleConsistencyScore: pr.styleConsistencyScore,
      overallScore: pr.overallScore,
      suggestedPromptAdditions: pr.suggestedPromptAdditions ?? null,
      classFlags: normalizeClassFlags(pr.classFlags),
    });
  }

  return { mapped, unmatchedEchoes };
}
