/**
 * Quality Check Prompt
 *
 * Evaluates all generated illustrations together for character and style consistency.
 * Produces specific, actionable per-page feedback that feeds back into re-generation prompts.
 */

import type { CharacterIdentity } from '../types.js';

export const QC_SYSTEM_PROMPT =
  "You are a quality assurance specialist for children's picture books. Your task is to evaluate generated illustrations for consistency, quality, and adherence to character identity across all pages of a book.";

export interface QCPromptOptions {
  /**
   * Number of validated character sheets prepended to the QC input (each
   * labeled "REFERENCE SHEET" — a non-numeric label so it can never collide
   * with a page ordinal). When > 0 the sheet is the ground truth for
   * character consistency.
   */
  sheetCount?: number;
  /**
   * Present when the generated cover joins the QC call (labeled "COVER").
   * The cover is scored with its own rubric variant: painted title text is
   * EXPECTED and must match expectedTitle exactly.
   */
  cover?: { expectedTitle: string } | null;
  /**
   * BRIDGE pages (generated WITHOUT a source photo), identified by their
   * "PAGE n" presentation ordinals — the same 1-based labels the caller
   * attaches to each page image (NOT DB page numbers). When non-empty the
   * prompt adds bridge-specific judging lines: strict character consistency
   * against the canonical description/sheet, and a near-duplicate-composition
   * failure check against the neighboring pages.
   */
  bridgePageOrdinals?: number[];
}

export function createQCPrompt(
  characterIdentity: CharacterIdentity | null,
  pageCount: number,
  language: string = 'en',
  options: QCPromptOptions = {}
): string {
  const sheetCount = options.sheetCount ?? 0;
  const characterSection = characterIdentity
    ? `Expected characters (canonical reference):\n${characterIdentity.characters.map(c => {
        const traits = c.physicalTraits;
        const features = traits.distinguishingFeatures.length > 0
          ? ` Features: ${traits.distinguishingFeatures.join(', ')}.`
          : '';
        return `- ${c.name || c.characterId} (${c.role}): ${traits.hairColor} ${traits.hairStyle} hair, ${traits.skinTone} skin, ${traits.bodyBuild}.${features} Style: ${c.styleTranslation}`;
      }).join('\n')}`
    : 'No character reference available — evaluate based on internal consistency only.';

  const sheetSection = sheetCount > 0
    ? `\nBefore the pages, ${sheetCount === 1 ? 'one image labeled "REFERENCE SHEET" is' : `${sheetCount} images labeled "REFERENCE SHEET" are`} provided: validated 2x2 turnaround grid(s) of the main character(s). These sheets are the GROUND TRUTH for character consistency — score each page's characters against the sheet (face, hair, skin tone, proportions), not merely against the other pages. Do NOT score the reference sheets themselves and do NOT include them in "pageResults".\n`
    : '';

  const coverSection = options.cover
    ? `\nOne image labeled "COVER" is provided: the book's generated cover. Score it in "coverResult" (NOT in "pageResults") using this COVER RUBRIC VARIANT:
- Painted title text on the cover is EXPECTED and correct — it must NOT count as stray text and must NOT cap the overall score.
- The painted title must read EXACTLY "${options.cover.expectedTitle}". A garbled, misspelled, incomplete, or duplicated title is a FAILURE: set titleMatches=false and passed=false, and describe the defect in "suggestedPromptAdditions".
- Any OTHER unintended text on the cover (beyond the title and the small logo mark) still caps OVERALL QUALITY at 4.
- Character and style consistency are scored exactly like a page${sheetCount > 0 ? ', against the REFERENCE SHEET' : ''}.
The cover PASSES only if titleMatches is true AND overall score >= 6 AND character consistency >= 5.\n`
    : '';

  const bridgeOrdinals = options.bridgePageOrdinals ?? [];
  const bridgeSection = bridgeOrdinals.length > 0
    ? `\nPage${bridgeOrdinals.length === 1 ? '' : 's'} ${bridgeOrdinals.map(n => `PAGE ${n}`).join(', ')} ${bridgeOrdinals.length === 1 ? 'was' : 'were'} generated WITHOUT a source photo (app-authored bridge pages). For ${bridgeOrdinals.length === 1 ? 'this page' : 'these pages'}:
- Judge character consistency STRICTLY against the canonical description${sheetCount > 0 ? ' and the REFERENCE SHEET' : ''} and against the adjacent pages — with no photo behind it, any drift here is pure model error.
- ALSO FAIL the page if it is a near-duplicate of a neighboring page's composition (same pose, same framing, same moment) — a bridge page must depict its own new moment, not restate the neighboring illustration.\n`
    : '';

  return `Evaluate these ${pageCount} children's book illustrations for quality and consistency.

The page images are provided in page order (page 1 through page ${pageCount}), and each page image is immediately preceded by a text label "PAGE n". In every result, set "pageNumber" to the n from that image's label — never renumber or reorder.
${sheetSection}${coverSection}${bridgeSection}
${characterSection}

For each illustration, evaluate:
1. CHARACTER CONSISTENCY (0-10): Do characters match the descriptions above? Are they recognizable as the same person across pages? Check hair color, skin tone, face shape, proportions.
2. STYLE CONSISTENCY (0-10): Does the illustration match the established art style? Is the construction method, lighting, and material rendering consistent with other pages?
3. OVERALL QUALITY (0-10): General illustration quality, composition, absence of artifacts or distortions. Apply these hard caps:
   - STRAY TEXT: Any unintended text, garbled or half-formed letters, captions, or watermark-like marks caps OVERALL QUALITY at 4. (Intentional onomatopoeia sound effects are allowed — but they must be correctly spelled and in the right script: ${language === 'ja' ? 'Japanese kana (e.g. ざぶーん, わーい) — Latin-alphabet sound effects are a FAILURE' : 'the Latin alphabet (e.g. SPLASH!, WHEE!) — non-Latin scripts are a FAILURE'}.)
   - ANATOMY: Clearly visible anatomical errors — wrong number of fingers, extra or missing limbs, fused or melted facial features, impossible joints — cap OVERALL QUALITY at 5.

A page PASSES if overall score >= 6.
A page FAILS if overall score < 6 OR character consistency < 5.

For each FAILED page, you MUST provide specific, actionable feedback in "suggestedPromptAdditions".
Be extremely precise about what is wrong and what the correct value should be.

BAD feedback:  "Hair color is inconsistent"
GOOD feedback: "HAIR COLOR WRONG: Rendered as light brown, must be black (short, slightly messy, side-swept). SKIN TONE DRIFT: Rendered too pale, must be warm golden-brown."

Reference the character identity descriptions provided above. Compare each illustration against the canonical traits and flag EXACTLY which attributes deviate and what they should be.

Focus on these critical attributes (in priority order):
1. Hair color and style
2. Skin tone
3. Facial features (eye style, expression approach)
4. Body proportions (head-to-body ratio)
5. Clothing accuracy vs reference photo
6. Art style consistency (construction method, texture, lighting)
7. Stray/garbled text and anatomical errors (see hard caps above) — when present, name them explicitly in "issues" and in "suggestedPromptAdditions" (e.g. "REMOVE STRAY TEXT: garbled lettering in top-right corner", "HANDS: left hand rendered with six fingers, must be five").`;
}

export const QC_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    summary: { type: 'string' },
    // Scored only when an image labeled "COVER" is in the input; null otherwise.
    coverResult: {
      type: ['object', 'null'],
      properties: {
        passed: { type: 'boolean' },
        titleMatches: { type: 'boolean' },
        characterConsistencyScore: { type: 'number' },
        styleConsistencyScore: { type: 'number' },
        overallScore: { type: 'number' },
        issues: { type: 'array', items: { type: 'string' } },
        suggestedPromptAdditions: { type: ['string', 'null'] },
      },
      required: ['passed', 'titleMatches', 'characterConsistencyScore', 'styleConsistencyScore', 'overallScore', 'issues', 'suggestedPromptAdditions'],
      additionalProperties: false,
    },
    pageResults: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pageNumber: { type: 'number' },
          passed: { type: 'boolean' },
          characterConsistencyScore: { type: 'number' },
          styleConsistencyScore: { type: 'number' },
          overallScore: { type: 'number' },
          issues: { type: 'array', items: { type: 'string' } },
          suggestedPromptAdditions: { type: ['string', 'null'] },
        },
        required: ['pageNumber', 'passed', 'characterConsistencyScore', 'styleConsistencyScore', 'overallScore', 'issues', 'suggestedPromptAdditions'],
        additionalProperties: false,
      },
    },
  },
  required: ['passed', 'summary', 'coverResult', 'pageResults'],
  additionalProperties: false,
} as const;
