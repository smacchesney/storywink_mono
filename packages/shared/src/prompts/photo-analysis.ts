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
  /**
   * Roster from an earlier pass over this book (set on refresh runs).
   * Lets the model reuse the same characterId for the same real
   * person/animal, so an already-answered naming chip's characterId link
   * survives a photo add/remove.
   */
  priorCharacters?: { characterId: string; role: string; name: string | null }[];
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
  /**
   * Set on NAMING questions: links the question to the roster entry it asks
   * about, so the parent's answer can merge back into that character's name.
   * Null for every other question kind.
   */
  characterId?: string | null;
  /**
   * 'naming' = person/pet naming; 'object' = companion-object special name
   * (free-text-first, empty options); 'other' = firsts/highlight. Optional in
   * TS because pre-existing stored questions lack it; the response schema
   * requires it on new generations.
   */
  kind?: 'naming' | 'object' | 'other';
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
    ? `Other people who may appear: ${input.additionalCharacters.map((c) => `${c.name} (${c.relationship})`).join(', ')}.`
    : '';
  const lang = input.language === 'ja' ? 'ja' : 'en';
  const priorRosterContext = input.priorCharacters?.length
    ? `These characters were identified in an earlier pass over this book's photos: ${input.priorCharacters
        .map((c) => `${c.characterId} (${c.role}${c.name ? `, name: ${c.name}` : ''})`)
        .join(
          '; ',
        )}. Reuse the SAME characterId for the same real person or animal wherever they still appear.`
    : '';

  return `Analyze all ${input.storyPages.length} photos, provided in page order. They come from one family and will become a personalized picture book for a toddler, illustrated in a "${input.artStyle}" art style.

${characterContext}
${additionalContext}
${priorRosterContext}

Produce ALL of the following:

## 1. Per-photo analysis ("pageAnalysis", one entry per photo, in order)
- setting: place, time of day, weather if visible ("backyard, sunny afternoon")
- action: what is happening ("jumping into a puddle, mid-splash")
- emotion: the child's visible feeling, specific ("delighted, mouth open mid-laugh")
- eventSignals: cues about what this moment MEANS — birthday cake, packed suitcase, band-aid, trophy, holiday decorations, a first-time wobble. Empty array if none.
- narrativeRole: where this photo naturally sits in a story arc — "opening" (establishes the world/desire), "rising" (builds), "peak" (the biggest moment), "quiet" (a tender/resting beat), "closing" (winds down). Distribute sensibly: roughly one opening, one or two peak candidates, one closing; most photos are "rising" or "quiet".
- characterIds: which of your characters (below) appear in this photo.

## 2. Character identity ("characters" + "sceneContext")
For EACH distinct person across the photos, AND each animal companion (pet) that appears in 2+ photos or is clearly central to a moment: characterId (child_1, adult_1, pet_1, ...), role (main_child, parent, grandparent, sibling, friend, pet...), name (from the context above if identifiable, else null), physicalTraits (apparentAge; hairColor as an exact shade; hairStyle with length/texture/parting/accessories; skinTone with warm/cool specificity; bodyBuild; distinguishingFeatures[]), typicalClothing, styleTranslation (how to render them in "${input.artStyle}" while staying instantly recognizable — materials, construction, colors, proportions), appearsOnPages (photo numbers 1-${input.storyPages.length}).
For pets, reuse the same trait fields naturally: hairColor = fur/coat color, hairStyle = coat length and texture, distinguishingFeatures = collar, markings, ear shape, size; typicalClothing = collar/harness or "none".
Also include AT MOST ONE companion object: a toy, plush, blanket, or clearly beloved object that appears in 2+ photos or is central to a peak moment (being hugged, carried, presented). Give it characterId object_1 and role "companion_object", and reuse the trait fields naturally: hairColor = material and color, hairStyle = texture and wear ("well-loved, slightly flattened fur"), distinguishingFeatures = ears/patches/tags/size relative to the child; typicalClothing = "none". Pick the most-photographed candidate; if nothing qualifies, include no object.
Be ruthlessly specific — an illustrator will use this as the canonical reference on every page. "Brown hair" is insufficient; "medium-length wavy dark brown hair parted slightly left, small red clip on the right" is the standard. Also give sceneContext: the overall environment pattern across photos.

## 3. The story brief ("eventSummary")
ONE warm sentence a parent would recognize as their day: "Emma's first trip to the beach with Grandma — nervous about the waves at first, then couldn't stop splashing." Ground it ONLY in what you can actually see or reasonably infer. ${lang === 'ja' ? 'Write eventSummary in natural Japanese.' : ''}

## 4. A suggested title ("suggestedTitle")
Short (2-6 words), warm, specific to these photos. ${lang === 'ja' ? 'In Japanese, hiragana/katakana only, no kanji.' : ''} Avoid generic titles like "A Special Day".

## 5. Micro-questions for the parent ("captureQuestions", 3 maximum)
Ask ONLY what the photos cannot tell you and what would most change the story. The parent answers with one tap, so each question needs 2-4 SHORT tappable options (the UI adds "skip" automatically, and on naming questions it also adds a "Someone else…" free-text option — do not include either). ${lang === 'ja' ? 'Write questions and options in natural Japanese.' : ''}

FIRST — naming questions (REQUIRED, with "characterId" set to the roster entry above):
Emit ONE naming question for EVERY character above whose name you do not know, who appears in 2 or more photos AND shares at least one photo with the main child. Never ask about background strangers or one-photo passersby. At most 2 naming questions — if more characters qualify, pick the two who appear most often.
- Anchor the question visually so the parent knows who you mean: "Who is the woman with the silver hair who's in several photos?" — for a pet: "Who is the fluffy grey cat?"
- Options must be the words the child would actually say: "Grandma" / "Grandpa" / "Auntie" / "Mummy" (for a pet: "Our dog" / "Grandma's dog"). A generic category like "Family friend" may appear as ONE option at most — it describes the relationship, it is not what a toddler calls someone.

NEXT — the companion-object question (kind "object", at most ONE, only when a companion object is in your roster and unnamed): ask if it has a special family name, anchored visually so the parent knows which object you mean: "That well-loved grey bunny is in lots of photos — does it have a name?" Set "characterId" to the object's roster id and "options" to an EMPTY array — the UI supplies a type-a-name affordance and a skip; never offer generic options like "Just a bunny".

THEN — other question kinds ("characterId": null, kind "other"), up to 3 questions total:
- Firsts/meaning: "Was this a special first?" with options like "First beach trip" / "First swim" / "Just a fun day"
- The moment that mattered: "What was the highlight?" with options drawn from the actual photos ("The huge splash" / "Ice cream after" / "Building the sandcastle")

Set "kind" on every question: "naming" for person/pet naming, "object" for the companion-object question, "other" for the rest. Naming questions come FIRST in the array (people and pets before the object question). Give each an id like "q1", "q2". Never ask what you already know, never ask more than 3.`;
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
          narrativeRole: {
            type: 'string',
            enum: ['opening', 'rising', 'peak', 'quiet', 'closing'],
          },
          characterIds: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'pageNumber',
          'setting',
          'action',
          'emotion',
          'eventSignals',
          'narrativeRole',
          'characterIds',
        ],
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
            required: [
              'apparentAge',
              'hairColor',
              'hairStyle',
              'skinTone',
              'bodyBuild',
              'distinguishingFeatures',
            ],
            additionalProperties: false,
          },
          typicalClothing: { type: 'string' },
          styleTranslation: { type: 'string' },
          appearsOnPages: { type: 'array', items: { type: 'number' } },
        },
        required: [
          'characterId',
          'role',
          'name',
          'physicalTraits',
          'typicalClothing',
          'styleTranslation',
          'appearsOnPages',
        ],
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
          characterId: { type: ['string', 'null'] },
          kind: { type: 'string', enum: ['naming', 'object', 'other'] },
        },
        required: ['id', 'question', 'options', 'characterId', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'pageAnalysis',
    'characters',
    'sceneContext',
    'eventSummary',
    'suggestedTitle',
    'captureQuestions',
  ],
  additionalProperties: false,
} as const;

// ---------------------------------------------------------------------------
// Subject detection (X7 batch studio) — roster-only perception variant
// ---------------------------------------------------------------------------

/**
 * Batch studio caps (owner decision 2026-07-12): tunable constants, the ONLY
 * place these numbers live — routes, schemas, and UI all read them from here.
 */
export const MAX_BATCH_PHOTOS = 10;
export const MAX_BATCH_SUBJECTS = 6;

export const SUBJECT_DETECTION_SYSTEM_PROMPT =
  "You are a perceptive visual analyst for a children's picture-book studio. Parents upload a handful of family photos; you identify every distinct person, pet, and beloved toy who could become a recurring illustrated character, and you describe each one precisely enough for an illustrator who has never seen them.";

export interface SubjectDetectionInput {
  photoCount: number;
  language?: string; // "en" | "ja" — parent-facing strings only
}

/** One detected subject — the server-side identity source for batch creation. */
export interface DetectedSubject {
  subjectId: string;
  role: string;
  kindGuess: 'CHILD' | 'ADULT' | 'PET' | 'TOY';
  /** One warm line so the parent knows who is meant — helper text, never a headline. */
  parentDescription: string;
  /** Short kind+trait label ("Grown-up with glasses") — NEVER a proper name. */
  defaultLabel: string;
  /** Clearly a foreground subject in at least one photo (vs a background passerby). */
  isForeground: boolean;
  physicalTraits: {
    apparentAge: string;
    hairColor: string;
    hairStyle: string;
    skinTone: string;
    bodyBuild: string;
    distinguishingFeatures: string[];
  };
  typicalClothing: string;
  styleTranslation: string;
  /** 1-based photo numbers this subject appears in. */
  photoIndexes: number[];
  /** The clearest, most frontal photo of this subject (1-based). */
  bestPhotoIndex: number;
}

export interface SubjectDetectionResponse {
  subjects: DetectedSubject[];
}

/**
 * Roster-only trimmed variant of the perception prompt for the batch studio:
 * who is in these photos, described canonically — no storyboard, no event
 * summary, no capture questions. styleTranslation is written for the
 * 'vignette' baseline; a different chosen style is swapped downstream
 * (sheetSubjectForStyle handles the mismatch).
 */
export function createSubjectDetectionPrompt(input: SubjectDetectionInput): string {
  const lang = input.language === 'ja' ? 'ja' : 'en';
  return `Analyze all ${input.photoCount} photos provided. They come from one family's camera roll. A parent wants to turn the people, pets, and beloved toys in them into recurring illustrated storybook characters — but only the ones they choose. Your roster is the menu they choose from.

Identify every DISTINCT subject worth offering, at most ${MAX_BATCH_SUBJECTS} (prefer the most-photographed and clearly foreground ones when more qualify):
- every distinct person (children and grown-ups)
- every animal companion (pet)
- every distinct beloved toy or cherished object that is clearly the subject of a photo (hugged, carried, posed, or deliberately photographed on its own — not scenery or background clutter)

A batch may be entirely toys — a parent introducing their child's toy cast one figure at a time. Offer each distinct toy as its own subject; never fold different toys into one.

Include background passersby ONLY when they plausibly belong to the family (recurring across photos or interacting with the children); mark anyone who is not clearly a foreground subject with isForeground=false so the app can leave them unselected.

For EACH subject provide:
1. subjectId: child_1, adult_1, pet_1, object_1, ...
2. role: main_child, sibling, parent, grandparent, friend, pet, companion_object, ...
3. kindGuess: CHILD | ADULT | PET | TOY
4. parentDescription: ONE short, warm, recognizing line a parent would instantly match to the right person — "the silver-haired woman with round glasses". Kind and factual, never judgmental about bodies. ${lang === 'ja' ? 'Write it in natural Japanese.' : ''}
5. defaultLabel: a 2-4 word placeholder label of kind + one distinguishing trait — "Grown-up with glasses", "Puppy", "Girl in the red coat". Never invent a proper name; the parent adds real names themselves. ${lang === 'ja' ? 'Write it in natural Japanese.' : ''}
6. isForeground: true when they are clearly a foreground subject in at least one photo; false for background figures.
7. physicalTraits (be ruthlessly specific — an illustrator uses this as the canonical reference): apparentAge; hairColor as an exact shade; hairStyle with length/texture/parting/accessories; skinTone with warm/cool specificity; bodyBuild; distinguishingFeatures[]. For pets: hairColor = fur/coat color, hairStyle = coat length and texture, distinguishingFeatures = collar, markings, ear shape, size. For a toy/object: hairColor = material and color, hairStyle = texture and wear.
8. typicalClothing: their most characteristic, NEUTRAL everyday outfit across the photos (collar/harness or "none" for pets and objects).
9. styleTranslation: how to render this subject in the "vignette" watercolor style while staying instantly recognizable — materials, construction, colors, proportions.
10. photoIndexes: which photos (1-${input.photoCount}) they appear in.
11. bestPhotoIndex: the single clearest, most frontal photo of them.

Never merge two different subjects (people, pets, or toys) into one, and never split one subject into two. If NO subject qualifies at all, return an empty subjects array.`;
}

export const SUBJECT_DETECTION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    subjects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subjectId: { type: 'string' },
          role: { type: 'string' },
          kindGuess: { type: 'string', enum: ['CHILD', 'ADULT', 'PET', 'TOY'] },
          parentDescription: { type: 'string' },
          defaultLabel: { type: 'string' },
          isForeground: { type: 'boolean' },
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
            required: [
              'apparentAge',
              'hairColor',
              'hairStyle',
              'skinTone',
              'bodyBuild',
              'distinguishingFeatures',
            ],
            additionalProperties: false,
          },
          typicalClothing: { type: 'string' },
          styleTranslation: { type: 'string' },
          photoIndexes: { type: 'array', items: { type: 'number' } },
          bestPhotoIndex: { type: 'number' },
        },
        required: [
          'subjectId',
          'role',
          'kindGuess',
          'parentDescription',
          'defaultLabel',
          'isForeground',
          'physicalTraits',
          'typicalClothing',
          'styleTranslation',
          'photoIndexes',
          'bestPhotoIndex',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['subjects'],
  additionalProperties: false,
} as const;

/** The character shape scopeCaptureQuestions needs — structurally satisfied
 * by CharacterIdentity['characters'] entries. */
export interface ScopeCharacterLike {
  characterId: string;
  role: string;
  name: string | null;
  appearsOnPages: number[];
}

/** How many of the (at most 3) chip slots naming questions may occupy, so a
 * firsts/highlight question usually survives. */
export const MAX_NAMING_QUESTIONS = 2;
export const MAX_CAPTURE_QUESTIONS = 3;

/**
 * Deterministic post-filter over the model's captureQuestions. The prompt
 * asks for scoped, naming-first questions, but the guarantee lives here:
 *
 * - a naming question (characterId set) survives ONLY when its character
 *   exists in the roster, is still unnamed, appears on 2+ photos, AND shares
 *   at least one photo with the main child — never background strangers
 * - one naming question per character (first wins)
 * - naming questions sort FIRST, capped at MAX_NAMING_QUESTIONS so a
 *   highlight/firsts question usually keeps a slot (overflow naming
 *   questions refill trailing slots when there aren't enough other kinds)
 * - MAX_CAPTURE_QUESTIONS total
 */
export function scopeCaptureQuestions(
  questions: CaptureQuestion[],
  characters: ScopeCharacterLike[],
): CaptureQuestion[] {
  const mainChild = characters.find((c) => c.role === 'main_child');
  const mainPages = new Set(mainChild?.appearsOnPages ?? []);
  const byId = new Map(characters.map((c) => [c.characterId, c]));

  const seenCharacterIds = new Set<string>();
  const peopleNaming: CaptureQuestion[] = [];
  const objectNaming: CaptureQuestion[] = [];
  const other: CaptureQuestion[] = [];

  for (const q of questions) {
    if (!q.characterId) {
      other.push(q);
      continue;
    }
    const character = byId.get(q.characterId);
    if (!character || character.name) continue; // unknown target, or already named
    if (character.role === 'main_child') continue; // the child is named on the sheet, never via a chip
    if (seenCharacterIds.has(q.characterId)) continue;
    const pages = character.appearsOnPages ?? [];
    if (pages.length < 2) continue; // one-photo passerby (or one-photo object)
    if (!pages.some((p) => mainPages.has(p))) continue; // background stranger — never sharing a photo with the child
    seenCharacterIds.add(q.characterId);
    if (character.role === 'companion_object') objectNaming.push(q);
    else peopleNaming.push(q);
  }

  // People and pets outrank the object question inside the shared naming cap.
  const naming = [...peopleNaming, ...objectNaming.slice(0, 1)];
  return [
    ...naming.slice(0, MAX_NAMING_QUESTIONS),
    ...other,
    ...naming.slice(MAX_NAMING_QUESTIONS),
  ].slice(0, MAX_CAPTURE_QUESTIONS);
}
