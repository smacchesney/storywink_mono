/**
 * Story Quality Check
 *
 * Text-only editorial review of a generated story BEFORE it reaches
 * STORY_READY (and before any illustration money is spent on it).
 * Mirrors the illustration QC pattern in book-finalize: score, and on
 * failure feed precise corrections back into one regeneration round.
 *
 * Refrain recurrence is deterministic string matching (countRefrainEchoes),
 * computed in code — the model only scores the subjective dimensions.
 */

import type { StoryArc, StoryPageResponse } from './story.js';

export const STORY_QC_SYSTEM_PROMPT =
  "You are a ruthless children's-book editor reviewing a picture-book manuscript for toddlers (ages 2-4). You evaluate narrative arc, read-aloud rhythm, and whether pages tell a story or merely caption photos. You never rewrite the story yourself — you score it and give precise, actionable corrections.";

export interface StoryQCInput {
  storyArc: StoryArc;
  pages: Pick<StoryPageResponse, 'pageNumber' | 'text'>[];
  language?: string; // "en" | "ja"
  theme?: string; // Parent's story context, if provided
}

export function createStoryQCPrompt(input: StoryQCInput): string {
  const pagesBlock = input.pages
    .map(p => `--- Page ${p.pageNumber} ---\n${p.text}`)
    .join('\n');

  return `Review this ${input.pages.length}-page toddler picture-book manuscript.

# Declared story arc
- Desire: ${input.storyArc.desire}
- Refrain: ${input.storyArc.refrain}
- Emotional peak: ${input.storyArc.emotionalPeak}
- Resolution: ${input.storyArc.resolution}
${input.theme ? `\n# Parent's context for this story\n"${input.theme}" — the story should feel true to this.\n` : ''}
# Manuscript
${pagesBlock}
--- End Manuscript ---

Score the manuscript:

1. arcCoherence (0-10): Do the pages actually deliver the declared arc — a desire established early, escalation through the middle, an emotional peak, a soft landing? A flat sequence of disconnected moments scores below 5.
2. readAloudRhythm (0-10): Read it aloud in your head. Varied sentence lengths, musicality, organic sound words score high. Monotonous subject-verb-object chains score below 5.
3. lastPageLanding (boolean): true only if the final page lands as a soft, warm exhale WITHOUT a summary statement ("What a wonderful day", "それはすてきないちにちでした" and the like are automatic false).
4. Per page, captionRisk (0-10): 0 = pure story (feeling, wonder, discovery); 10 = pure photo caption ("Kai is at the beach. He sees waves."). Anything that mostly narrates what a camera would see scores 7+.
${input.language === 'ja' ? '\n5. The text must be Japanese in hiragana/katakana with NO kanji. Flag any kanji as a page issue.\n' : ''}
If ANY of these fail (arcCoherence < 6, readAloudRhythm < 6, lastPageLanding false, or any page captionRisk >= 7), write "feedback": a numbered list of specific corrections. Reference page numbers. Say exactly what is wrong and what a fix looks like — do not write replacement text yourself.

BAD feedback:  "Page 3 is too caption-like"
GOOD feedback: "Page 3 only describes the visible scene (girl on swing). Rewrite from her inner experience — what does the swoop feel like in her tummy? Add one sensory or imaginative element beyond the photo."

If everything passes, set "feedback" to null.`;
}

export const STORY_QC_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    arcCoherence: { type: 'number', description: '0-10' },
    readAloudRhythm: { type: 'number', description: '0-10' },
    lastPageLanding: { type: 'boolean' },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pageNumber: { type: 'number' },
          captionRisk: { type: 'number', description: '0-10' },
          issue: { type: ['string', 'null'], description: 'Specific problem on this page, or null' },
        },
        required: ['pageNumber', 'captionRisk', 'issue'],
        additionalProperties: false,
      },
    },
    feedback: { type: ['string', 'null'], description: 'Numbered corrections if failing, else null' },
  },
  required: ['arcCoherence', 'readAloudRhythm', 'lastPageLanding', 'pages', 'feedback'],
  additionalProperties: false,
} as const;

export interface StoryQCResponse {
  arcCoherence: number;
  readAloudRhythm: number;
  lastPageLanding: boolean;
  pages: { pageNumber: number; captionRisk: number; issue: string | null }[];
  feedback: string | null;
}

/** Thresholds shared by the worker's pass/fail decision. */
export const STORY_QC_THRESHOLDS = {
  minArcCoherence: 6,
  minReadAloudRhythm: 6,
  maxCaptionRisk: 6, // a page fails at >= 7
  minRefrainEchoes: 3,
} as const;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"“”‘’«»„…—–\-()[\]{}、。！？「」『』・〜ー]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Count how many pages echo the refrain. Deterministic — no model call.
 *
 * The refrain is supposed to recur WITH VARIATION, so exact-substring
 * matching under-counts. A page "echoes" when:
 * - en (space-delimited): it contains at least half of the refrain's
 *   significant words (length > 2 after normalization).
 * - ja (no word boundaries): it contains some contiguous run of at least
 *   4 characters (or the whole refrain, if shorter) from the refrain.
 */
export function countRefrainEchoes(
  refrain: string,
  pageTexts: string[],
  language: string = 'en',
): number {
  const cleanRefrain = normalize(refrain);
  if (!cleanRefrain) return 0;

  if (language === 'ja') {
    const compact = cleanRefrain.replace(/ /g, '');
    const runLength = Math.min(4, compact.length);
    const runs = new Set<string>();
    for (let i = 0; i + runLength <= compact.length; i++) {
      runs.add(compact.slice(i, i + runLength));
    }
    return pageTexts.filter(text => {
      const compactPage = normalize(text).replace(/ /g, '');
      for (const run of runs) {
        if (compactPage.includes(run)) return true;
      }
      return false;
    }).length;
  }

  const words = cleanRefrain.split(' ').filter(w => w.length > 2);
  if (words.length === 0) return 0;
  const needed = Math.ceil(words.length / 2);
  return pageTexts.filter(text => {
    const page = ` ${normalize(text)} `;
    const hits = words.filter(w => page.includes(` ${w} `)).length;
    return hits >= needed;
  }).length;
}
