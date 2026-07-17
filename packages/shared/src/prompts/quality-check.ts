/**
 * Quality Check Prompt
 *
 * Evaluates all generated illustrations together for character and style consistency.
 * Produces specific, actionable per-page feedback that feeds back into re-generation prompts.
 */

import type { CharacterIdentity, QcClassFlags } from '../types.js';

export const QC_SYSTEM_PROMPT =
  "You are a quality assurance specialist for children's picture books. Your task is to evaluate generated illustrations for consistency, quality, and adherence to character identity across all pages of a book.";

/**
 * The rubric-v2 defect classes the judge scores per page (`classFlags`). These
 * keys are the single source of truth shared by the response schema, the
 * `QcClassFlags` type, and the worker's gating — a class named here must exist
 * in all three.
 */
export const QC_CLASSES = [
  'renderedText',
  'intraImageDuplicate',
  'missingExpectedCast',
  'speciesMismatch',
  'characterHybrid',
  'propHolderMismatch',
  'focalActionMismatch',
  'moodMismatch',
] as const;
export type QcClass = (typeof QC_CLASSES)[number];

/**
 * GATING POSTURE (X12-C C4). The declared BLOCKING set: a page carrying any of
 * these flags is re-queued for re-illustration (bounded by MAX_QC_ROUNDS).
 * Everything else in `QC_CLASSES` is TELEMETRY-ONLY for now — logged per page
 * (`qc_class_flags`), never blocking.
 *
 * Owner mandate: ALL classes end up gated; telemetry-first is a stepping stone,
 * not an end state.
 *
 * PROMOTION CRITERION (documented, not implemented here): a telemetry class
 * promotes into this set once it holds >=90% human-reviewed precision over
 * >=10 finalized books OR 2 weeks of `qc_class_flags` data, whichever comes
 * first. The QC ledger owns tracking that precision. Promotion itself is a
 * one-line change: add the class id to this array. Nothing else in the split
 * needs to move — the worker derives requeue purely from this constant.
 */
export const QC_BLOCKING_CLASSES = ['renderedText', 'intraImageDuplicate'] as const;
export type QcBlockingClass = (typeof QC_BLOCKING_CLASSES)[number];

/**
 * The all-clean default for a page that was never scored (a qc_error sentinel)
 * or whose classFlags the judge omitted. The two nullable classes default to
 * `null` (no-op / nothing judged), the rest to `false` (defect absent). NEVER
 * use this to stand in for a real clean verdict — it means "unjudged".
 */
export function emptyQcClassFlags(): QcClassFlags {
  return {
    renderedText: false,
    intraImageDuplicate: false,
    missingExpectedCast: false,
    speciesMismatch: false,
    characterHybrid: false,
    propHolderMismatch: null,
    focalActionMismatch: null,
    moodMismatch: null,
  };
}

/** One page's context fed to the judge: expected cast, story text, held props. */
export interface QcPageContext {
  /** The 1-based "PAGE n" presentation ordinal this context belongs to. */
  ordinal: number;
  /** The page's story text (the overlay copy), or null when the page has none. */
  text: string | null;
  /** Expected cast — REAL names + species/kind phrases (see the payload comment). */
  cast: Array<{ name: string; species: string }>;
  /**
   * Held props with holder phrasing (e.g. "lantern held by Kai"). Optional and
   * usually empty today — the prop-holder class is a no-op until Track B
   * enriches props with holders.
   */
  props?: string[];
  /**
   * X13 Track L: the page's stated emotional beat (feeds the moodMismatch
   * telemetry class). Present only for avatar scenes that authored one.
   */
  mood?: string | null;
  /**
   * X13 Track L: the single character+action the composition centers on
   * (sharpens the focalActionMismatch judgment). Present only for avatar scenes.
   */
  focus?: string | null;
}

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
  /**
   * Per-page context (rubric v2): the expected cast, story text, and any
   * holder-annotated props for each "PAGE n" in this call. Feeds the exact-cast,
   * species-match, focal-action, and prop-holder classes. Empty/omitted on the
   * cover-only call and on any book whose worker did not build the feed.
   */
  pageContext?: QcPageContext[];
  /**
   * X13 Track T (TOYS_COME_ALIVE_ENABLED, default absent/false = today's
   * rubric byte-identical). When on, the speciesMismatch rubric wording
   * treats a lively, LIFE-SIZED toy as CORRECT (kind = the creature, e.g.
   * crocodile; "toy" describes material, not size or stillness), so the judge
   * no longer flags a toy brought to life. QC_BLOCKING_CLASSES are untouched;
   * speciesMismatch stays telemetry-only either way.
   */
  toysComeAlive?: boolean;
}

export function createQCPrompt(
  characterIdentity: CharacterIdentity | null,
  pageCount: number,
  language: string = 'en',
  options: QCPromptOptions = {},
): string {
  const sheetCount = options.sheetCount ?? 0;
  const characterSection = characterIdentity
    ? `Expected characters (canonical reference):\n${characterIdentity.characters
        .map((c) => {
          const traits = c.physicalTraits;
          const features =
            traits.distinguishingFeatures.length > 0
              ? ` Features: ${traits.distinguishingFeatures.join(', ')}.`
              : '';
          return `- ${c.name || c.characterId} (${c.role}): ${traits.hairColor} ${traits.hairStyle} hair, ${traits.skinTone} skin, ${traits.bodyBuild}.${features} Style: ${c.styleTranslation}`;
        })
        .join('\n')}`
    : 'No character reference available — evaluate based on internal consistency only.';

  const sheetSection =
    sheetCount > 0
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
  const bridgeSection =
    bridgeOrdinals.length > 0
      ? `\nPage${bridgeOrdinals.length === 1 ? '' : 's'} ${bridgeOrdinals.map((n) => `PAGE ${n}`).join(', ')} ${bridgeOrdinals.length === 1 ? 'was' : 'were'} generated WITHOUT a source photo (app-authored bridge pages). For ${bridgeOrdinals.length === 1 ? 'this page' : 'these pages'}:
- Judge character consistency STRICTLY against the canonical description${sheetCount > 0 ? ' and the REFERENCE SHEET' : ''} and against the adjacent pages — with no photo behind it, any drift here is pure model error.
- ALSO FAIL the page if it is a near-duplicate of a neighboring page's composition (same pose, same framing, same moment) — a bridge page must depict its own new moment, not restate the neighboring illustration.\n`
      : '';

  // Per-page context feed (rubric v2). The names + species below are the REAL
  // character names/kinds. The judge legitimately receives them: it scores
  // APPEARANCE against the reference sheets, so it needs to know which named
  // character to expect and what kind of creature each is. This does NOT
  // conflict with name-neutralization — the illustration prompts sent to the
  // OpenAI renderer are name-neutralized, but that neutralization is a
  // render-time concern and never reaches this evaluation payload.
  // Appearance anchor for the feed header: sheets when present, else the
  // canonical identity section — and when NEITHER exists (no sheets, null
  // identity) the character section explicitly says no reference is available,
  // so pointing at "descriptions below" would dangle; fall back to the same
  // internal-consistency basis that section declares.
  const appearanceAnchor =
    sheetCount > 0
      ? ' against the REFERENCE SHEETS'
      : characterIdentity
        ? ' against the canonical descriptions below'
        : ' for internal consistency across pages';
  const pageContext = options.pageContext ?? [];
  const pageContextSection =
    pageContext.length > 0
      ? `\nPER-PAGE CONTEXT FEED — the expected cast and story text for each "PAGE n" image (match by ordinal). The names and species are the REAL character names/kinds, provided so you can judge each named character's APPEARANCE${appearanceAnchor}:
${pageContext
  .map((p) => {
    const cast = p.cast.length
      ? p.cast.map((c) => `${c.name} (${c.species})`).join(', ')
      : '(none expected)';
    const props = p.props && p.props.length ? `\n  Held props: ${p.props.join('; ')}.` : '';
    const mood = p.mood && p.mood.trim() ? `\n  Mood: ${p.mood.trim()}.` : '';
    const focus = p.focus && p.focus.trim() ? `\n  Focus: ${p.focus.trim()}.` : '';
    const text = p.text && p.text.trim() ? `"${p.text.trim()}"` : '(no story text on this page)';
    return `PAGE ${p.ordinal} — Expected cast: ${cast}.${props}${mood}${focus}\n  Story text: ${text}`;
  })
  .join('\n')}\n`
      : '';

  // X13 Track T (TOYS_COME_ALIVE_ENABLED): when on, teach the judge that a toy
  // brought to life is CORRECT — "toy" is a material, not a size or a pose — so
  // a lively, life-sized toy of the right KIND never counts as a speciesMismatch.
  // Absent/off → empty string → the speciesMismatch line is byte-identical.
  const speciesMismatchLivingClause = options.toysComeAlive
    ? ` A toy brought to life is NOT a speciesMismatch: "toy" describes its material, not its size or stillness — a toy crocodile rendered ALIVE and LIFE-SIZED (moving, expressive, adventuring side by side) is still a crocodile and CORRECT. Only a genuine change of KIND (that crocodile drawn as a griffin, dragon, or dog) fails.`
    : '';

  // Cover-only calls carry pageCount 0 (only the COVER image). The interior
  // "these N illustrations … page 1 through page N" framing is nonsense there,
  // so give the cover its own opening and route the judge to coverResult.
  const isCoverOnly = pageCount === 0;
  const framing = isCoverOnly
    ? `Evaluate this book cover illustration for quality and consistency. This call carries NO interior story-page images — score ONLY the cover in "coverResult" and return an empty "pageResults" array.`
    : `Evaluate these ${pageCount} children's book illustrations for quality and consistency.

The page images are provided in page order (page 1 through page ${pageCount}), and each page image is immediately preceded by a text label "PAGE n". In every result, set "pageNumber" to the n from that image's label — never renumber or reorder.`;

  return `${framing}
${sheetSection}${coverSection}${bridgeSection}${pageContextSection}
${characterSection}

For each illustration, evaluate:
1. CHARACTER CONSISTENCY (0-10): Do characters match the descriptions above? Are they recognizable as the same person across pages? Check hair color, skin tone, face shape, proportions.
2. STYLE CONSISTENCY (0-10): Does the illustration match the established art style? Is the construction method, lighting, and material rendering consistent with other pages?
3. OVERALL QUALITY (0-10): General illustration quality, composition, absence of artifacts or distortions. Apply these hard caps:
   - RENDERED TEXT: Interior page illustrations must contain NO lettering of ANY kind. Any rendered text — words, captions, labels, signage, watermark-like marks, garbled or half-formed letters, AND sound-effect / onomatopoeia words (${language === 'ja' ? 'e.g. ざぶーん, わーい, SPLASH' : 'e.g. SPLASH!, WHEE!, ざぶーん'}) — is a FAILURE. There is NO exception for sound words or onomatopoeia: the story's words live in a separate text overlay outside the art, so any lettering inside the illustration is a defect. Set classFlags.renderedText=true and cap OVERALL QUALITY at 4.
   - ANATOMY: Clearly visible anatomical errors — wrong number of fingers, extra or missing limbs, fused or melted facial features, impossible joints — cap OVERALL QUALITY at 5.

PER-PAGE DEFECT CLASSES — for EACH interior page, set every field of "classFlags". Judge these against each page's expected cast, story text, stated mood, and any held props (fed above when present)${sheetCount > 0 ? ', and the REFERENCE SHEETS' : ''}. Convention: true = the defect IS present in that page's art.
- renderedText (boolean): true if the page contains ANY rendered lettering, sound words included (same as the RENDERED TEXT cap above).
- intraImageDuplicate (boolean): true if the SAME character is drawn more than once in the one image (e.g. two copies of the same child side by side).
- missingExpectedCast (boolean): true if a character listed in this page's Expected cast is ABSENT from the art.
- speciesMismatch (boolean): true if a named character is rendered as the WRONG kind of creature — judge the KIND against the Expected cast species, never the name. Example: a character listed as "a green toy crocodile" drawn as a griffin, dragon, or dog is a speciesMismatch.${speciesMismatchLivingClause}
- characterHybrid (boolean): true if ONE figure fuses two cast members' bodies together, OR fuses a cast member with a non-cast creature into a single whole creature. This is the WHOLE-creature case — broader than the ANATOMY cap's fused facial features.
- propHolderMismatch (boolean or null): only when this page's Held props line names WHO holds a prop, set true if that prop is drawn held by the WRONG character. Set null when no Held props line assigns a holder — there is nothing to judge.
- focalActionMismatch (boolean or null): compare the art to this page's Story text — set true if the art does NOT depict the text's main who-does-what (the subject performing the described action). Set null when the page has no Story text.
- moodMismatch (boolean or null): compare the emotional tone of the art — the characters' facial expressions and body language, plus the lighting — to this page's stated Mood. Set true only when the art's mood clearly CONTRADICTS it (e.g. Mood "gleeful" but the figures look frightened or blank). Set null when this page has no Mood fed.

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
7. Rendered text and anatomical errors (see hard caps above) — when present, name them explicitly in "issues" and in "suggestedPromptAdditions" (e.g. "REMOVE ALL TEXT: sound word 'SPLASH' rendered in the water, no lettering is allowed", "HANDS: left hand rendered with six fingers, must be five").`;
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
      required: [
        'passed',
        'titleMatches',
        'characterConsistencyScore',
        'styleConsistencyScore',
        'overallScore',
        'issues',
        'suggestedPromptAdditions',
      ],
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
          // Rubric-v2 defect classes. Every field is required (strict mode);
          // the two nullable classes carry null for the no-op case. Keys must
          // stay in lockstep with QC_CLASSES and the QcClassFlags type.
          classFlags: {
            type: 'object',
            properties: {
              renderedText: { type: 'boolean' },
              intraImageDuplicate: { type: 'boolean' },
              missingExpectedCast: { type: 'boolean' },
              speciesMismatch: { type: 'boolean' },
              characterHybrid: { type: 'boolean' },
              propHolderMismatch: { type: ['boolean', 'null'] },
              focalActionMismatch: { type: ['boolean', 'null'] },
              moodMismatch: { type: ['boolean', 'null'] },
            },
            required: [
              'renderedText',
              'intraImageDuplicate',
              'missingExpectedCast',
              'speciesMismatch',
              'characterHybrid',
              'propHolderMismatch',
              'focalActionMismatch',
              'moodMismatch',
            ],
            additionalProperties: false,
          },
        },
        required: [
          'pageNumber',
          'passed',
          'characterConsistencyScore',
          'styleConsistencyScore',
          'overallScore',
          'issues',
          'suggestedPromptAdditions',
          'classFlags',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['passed', 'summary', 'coverResult', 'pageResults'],
  additionalProperties: false,
} as const;
