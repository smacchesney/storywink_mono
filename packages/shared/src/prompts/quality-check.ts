/**
 * Quality Check Prompt
 *
 * Evaluates all generated illustrations together for character and style consistency.
 * Produces specific, actionable per-page feedback that feeds back into re-generation prompts.
 */

import type { CharacterIdentity } from '../types.js';

export const QC_SYSTEM_PROMPT =
  "You are a quality assurance specialist for children's picture books. Your task is to evaluate generated illustrations for consistency, quality, and adherence to character identity across all pages of a book.";

export function createQCPrompt(
  characterIdentity: CharacterIdentity | null,
  pageCount: number
): string {
  const characterSection = characterIdentity
    ? `Expected characters (canonical reference):\n${characterIdentity.characters.map(c => {
        const traits = c.physicalTraits;
        const features = traits.distinguishingFeatures.length > 0
          ? ` Features: ${traits.distinguishingFeatures.join(', ')}.`
          : '';
        return `- ${c.name || c.characterId} (${c.role}): ${traits.hairColor} ${traits.hairStyle} hair, ${traits.skinTone} skin, ${traits.bodyBuild}.${features} Style: ${c.styleTranslation}`;
      }).join('\n')}`
    : 'No character reference available — evaluate based on internal consistency only.';

  return `Evaluate these ${pageCount} children's book illustrations for quality and consistency.

The images are provided in page order (page 1 through page ${pageCount}).

${characterSection}

For each illustration, evaluate:
1. CHARACTER CONSISTENCY (0-10): Do characters match the descriptions above? Are they recognizable as the same person across pages? Check hair color, skin tone, face shape, proportions.
2. STYLE CONSISTENCY (0-10): Does the illustration match the established art style? Is the construction method, lighting, and material rendering consistent with other pages?
3. OVERALL QUALITY (0-10): General illustration quality, composition, absence of artifacts or distortions.

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
6. Art style consistency (construction method, texture, lighting)`;
}

export const QC_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    summary: { type: 'string' },
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
  required: ['passed', 'summary', 'pageResults'],
  additionalProperties: false,
} as const;
