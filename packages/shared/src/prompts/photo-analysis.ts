/**
 * Photo Perception Pass
 *
 * One vision call over ALL of a book's photos, run at book creation —
 * BEFORE story generation. It merges what used to be two blind spots:
 *
 * 1. Perception for the WRITER: per-photo scene/action/emotion + a
 *    narrative role, the one-line event summary the parent can correct,
 *    and micro-questions that ask the parent ONLY what pixels can't say
 *    (firsts, names, meaning). Recognition instead of composition.
 * 2. Character identity for the ILLUSTRATOR: the same canonical
 *    per-person description character-extraction produces, so the
 *    extraction worker can skip its own vision call when this is fresh.
 */

import type { CharacterIdentity } from '../types.js';

export const PHOTO_ANALYSIS_SYSTEM_PROMPT =
  "You are a perceptive story consultant and visual analyst for a children's picture-book studio. Parents upload family photos; you see what is happening, who appears, and what probably matters emotionally — and you know exactly which questions only the parent can answer. You are also an expert at extracting precise, consistent character descriptions for illustrators.";

export interface PhotoAnalysisInput {
  childName: string | null;
  additionalCharacters: { name: string; relationship: string }[] | null;
  artStyle: string;
  language?: string; // "en" | "ja"
  storyPages: {
    pageNumber: number;
    assetId: string | null;
    imageUrl: string;
  }[];
}

export interface PageAnalysis {
  pageNumber: number;
  assetId?: string | null; // stamped by the worker for freshness checks
  setting: string;
  action: string;
  emotion: string;
  eventSignals: string[];
  narrativeRole: 'opening' | 'rising' | 'peak' | 'quiet' | 'closing';
  characterIds: string[];
}

export interface CaptureQuestion {
  id: string;
  question: string;
  options: string[];
  answer?: string | null; // set by the parent in the UI
}

export interface PhotoAnalysisResponse {
  pageAnalysis: PageAnalysis[];
  characters: CharacterIdentity['characters'];
  sceneContext: string;
  eventSummary: string;
  suggestedTitle: string;
  captureQuestions: CaptureQuestion[];
}

export function createPhotoAnalysisPrompt(input: PhotoAnalysisInput): string {
  const characterContext = input.childName
    ? `The main child is named "${input.childName}".`
    : 'Identify the main child in the photos.';
  const additionalContext = input.additionalCharacters?.length
    ? `Other people who may appear: ${input.additionalCharacters.map(c => `${c.name} (${c.relationship})`).join(', ')}.`
    : '';
  const lang = input.language === 'ja' ? 'ja' : 'en';

  return `Analyze all ${input.storyPages.length} photos, provided in page order. They come from one family and will become a personalized picture book for a toddler, illustrated in a "${input.artStyle}" art style.

${characterContext}
${additionalContext}

Produce ALL of the following:

## 1. Per-photo analysis ("pageAnalysis", one entry per photo, in order)
- setting: place, time of day, weather if visible ("backyard, sunny afternoon")
- action: what is happening ("jumping into a puddle, mid-splash")
- emotion: the child's visible feeling, specific ("delighted, mouth open mid-laugh")
- eventSignals: cues about what this moment MEANS — birthday cake, packed suitcase, band-aid, trophy, holiday decorations, a first-time wobble. Empty array if none.
- narrativeRole: where this photo naturally sits in a story arc — "opening" (establishes the world/desire), "rising" (builds), "peak" (the biggest moment), "quiet" (a tender/resting beat), "closing" (winds down). Distribute sensibly: roughly one opening, one or two peak candidates, one closing; most photos are "rising" or "quiet".
- characterIds: which of your characters (below) appear in this photo.

## 2. Character identity ("characters" + "sceneContext")
For EACH distinct person across the photos: characterId (child_1, adult_1, ...), role (main_child, parent, grandparent, sibling, friend...), name (from the context above if identifiable, else null), physicalTraits (apparentAge; hairColor as an exact shade; hairStyle with length/texture/parting/accessories; skinTone with warm/cool specificity; bodyBuild; distinguishingFeatures[]), typicalClothing, styleTranslation (how to render them in "${input.artStyle}" while staying instantly recognizable — materials, construction, colors, proportions), appearsOnPages (photo numbers 1-${input.storyPages.length}).
Be ruthlessly specific — an illustrator will use this as the canonical reference on every page. "Brown hair" is insufficient; "medium-length wavy dark brown hair parted slightly left, small red clip on the right" is the standard. Also give sceneContext: the overall environment pattern across photos.

## 3. The story brief ("eventSummary")
ONE warm sentence a parent would recognize as their day: "Emma's first trip to the beach with Grandma — nervous about the waves at first, then couldn't stop splashing." Ground it ONLY in what you can actually see or reasonably infer. ${lang === 'ja' ? 'Write eventSummary in natural Japanese.' : ''}

## 4. A suggested title ("suggestedTitle")
Short (2-6 words), warm, specific to these photos. ${lang === 'ja' ? 'In Japanese, hiragana/katakana only, no kanji.' : ''} Avoid generic titles like "A Special Day".

## 5. Micro-questions for the parent ("captureQuestions", 2-3 maximum)
Ask ONLY what the photos cannot tell you and what would most change the story. The parent answers with one tap, so each question needs 2-4 SHORT tappable options (the UI adds "skip" and free-text automatically — do not include them). ${lang === 'ja' ? 'Write questions and options in natural Japanese.' : ''}
Good kinds of questions:
- Firsts/meaning: "Was this a special first?" with options like "First beach trip" / "First swim" / "Just a fun day"
- Unidentified recurring people: "Who is the woman with ${input.childName || 'the child'} in several photos?" with options like "Grandma" / "Aunt" / "Family friend" (ONLY if someone recurs and isn't named in the context above)
- The moment that mattered: "What was the highlight?" with options drawn from the actual photos ("The huge splash" / "Ice cream after" / "Building the sandcastle")
Give each an id like "q1", "q2". Never ask what you already know, never ask more than 3.`;
}

export const PHOTO_ANALYSIS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    pageAnalysis: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pageNumber: { type: 'number' },
          setting: { type: 'string' },
          action: { type: 'string' },
          emotion: { type: 'string' },
          eventSignals: { type: 'array', items: { type: 'string' } },
          narrativeRole: { type: 'string', enum: ['opening', 'rising', 'peak', 'quiet', 'closing'] },
          characterIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['pageNumber', 'setting', 'action', 'emotion', 'eventSignals', 'narrativeRole', 'characterIds'],
        additionalProperties: false,
      },
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          characterId: { type: 'string' },
          role: { type: 'string' },
          name: { type: ['string', 'null'] },
          physicalTraits: {
            type: 'object',
            properties: {
              apparentAge: { type: 'string' },
              hairColor: { type: 'string' },
              hairStyle: { type: 'string' },
              skinTone: { type: 'string' },
              bodyBuild: { type: 'string' },
              distinguishingFeatures: { type: 'array', items: { type: 'string' } },
            },
            required: ['apparentAge', 'hairColor', 'hairStyle', 'skinTone', 'bodyBuild', 'distinguishingFeatures'],
            additionalProperties: false,
          },
          typicalClothing: { type: 'string' },
          styleTranslation: { type: 'string' },
          appearsOnPages: { type: 'array', items: { type: 'number' } },
        },
        required: ['characterId', 'role', 'name', 'physicalTraits', 'typicalClothing', 'styleTranslation', 'appearsOnPages'],
        additionalProperties: false,
      },
    },
    sceneContext: { type: 'string' },
    eventSummary: { type: 'string' },
    suggestedTitle: { type: 'string' },
    captureQuestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'question', 'options'],
        additionalProperties: false,
      },
    },
  },
  required: ['pageAnalysis', 'characters', 'sceneContext', 'eventSummary', 'suggestedTitle', 'captureQuestions'],
  additionalProperties: false,
} as const;
