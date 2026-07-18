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

import type { BeatSheetEntry, StoryArc, StoryPageResponse } from './story.js';

export const STORY_QC_SYSTEM_PROMPT =
  "You are a ruthless children's-book editor reviewing a picture-book manuscript for children ages 3-5 — every book should be a real little adventure with a beginning, a problem, and a satisfying end. You evaluate narrative arc, read-aloud rhythm, and whether pages tell a story or merely caption photos. You never rewrite the story yourself — you score it and give precise, actionable corrections.";

export interface StoryQCInput {
  storyArc: StoryArc;
  pages: Pick<StoryPageResponse, 'pageNumber' | 'text'>[];
  language?: string; // "en" | "ja"
  theme?: string; // Parent's story context, if provided
  eventSummary?: string; // Parent-confirmed "what actually happened". Supersedes theme, same as generation.
  confirmedFacts?: string[]; // Parent's tapped answers ("Who is the woman...? → Grandma")
  /** STORY QUALITY V2: the per-page structural plan the pages promised to deliver. */
  beatSheet?: BeatSheetEntry[];
}

/** "--- Page N (beat: try — first try fails) ---" when a beat exists. */
function pageHeader(pageNumber: number, beats?: Map<number, BeatSheetEntry>): string {
  const beat = beats?.get(pageNumber);
  return beat
    ? `--- Page ${pageNumber} (beat: ${beat.role} — ${beat.goal}) ---`
    : `--- Page ${pageNumber} ---`;
}

function beatMap(beatSheet?: BeatSheetEntry[]): Map<number, BeatSheetEntry> | undefined {
  if (!beatSheet?.length) return undefined;
  return new Map(beatSheet.map((b) => [b.pageNumber, b]));
}

export function createStoryQCPrompt(input: StoryQCInput): string {
  const beats = beatMap(input.beatSheet);
  const pagesBlock = input.pages
    .map((p) => `${pageHeader(p.pageNumber, beats)}\n${p.text}`)
    .join('\n');

  // Mirror generation: exactly ONE experience-context block, with the
  // confirmed eventSummary superseding the legacy free-text theme, and
  // confirmedFacts rendered only under the eventSummary-present condition.
  const contextBlock = input.eventSummary
    ? `\n# What actually happened (confirmed by the parent)\n"${input.eventSummary}" — the story must deliver this specific day.\n${
        input.confirmedFacts?.length
          ? input.confirmedFacts.map((f) => `- Parent confirmed: ${f}`).join('\n') + '\n'
          : ''
      }`
    : input.theme
      ? `\n# Parent's context for this story\n"${input.theme}" — the story should feel true to this.\n`
      : '';

  return `Review this ${input.pages.length}-page picture-book manuscript for children ages 3-5.

# Declared story arc
- Desire: ${input.storyArc.desire}
- Obstacle: ${input.storyArc.obstacle}
- Throughline: ${input.storyArc.throughline}
- Try: ${input.storyArc.tryAndOvercome ?? '(none declared)'}
- Refrain: ${input.storyArc.refrain}
- Emotional peak: ${input.storyArc.emotionalPeak}
- Resolution: ${input.storyArc.resolution}
${contextBlock}
# Manuscript
${pagesBlock}
--- End Manuscript ---

Score the manuscript:

1. arcCoherence (0-10): Do the pages actually deliver the declared arc — a desire established early, escalation through the middle, an emotional peak, a soft landing? A flat sequence of disconnected moments scores below 5.
2. readAloudRhythm (0-10): Read it aloud in your head. Varied sentence lengths and musicality score high; leaning on sound words does NOT — a story that reaches for a sound word where a vivid verb or image would do scores below 6. Monotonous subject-verb-object chains score below 5.
3. lastPageLanding (boolean): true only if the final page lands as a soft, warm exhale WITHOUT a summary statement ("What a wonderful day", "それはすてきないちにちでした" and the like are automatic false).
4. Per page, captionRisk (0-10): 0 = pure story (feeling, wonder, discovery); 10 = pure photo caption ("Kai is at the beach. He sees waves."). Anything that mostly narrates what a camera would see scores 7+.
5. truthToEvent (0-10, or null): ${
    input.eventSummary
      ? 'Does the manuscript deliver the specific day described under "What actually happened" — its people, its place, its arc — rather than a generic day-shaped story? A story that could be about any day scores below 5.'
      : 'No event summary was provided — return null.'
  }
6. soundOverload (boolean): true if the manuscript leans on sound words — any page that stacks 2+ sound words, or makes a sound word the page's main event. A story that reaches for a sound word where a vivid verb or image would do is overloaded. When true, name the offending pages in "feedback".
7. agency (0-10): Is the child the DOER — one clear goal, a real obstacle, and a try-wobble-try before the payoff? A child who only moves THROUGH a tour of moments (witnessing, not acting) scores below 5.
8. Per page, deliversBeat (boolean): each page header declares its beat (role — goal). true only if the page's text actually does that job for the throughline. A lovely page doing a DIFFERENT job is false. If a page shows no beat, set true.
${input.language === 'ja' ? '\n9. The text must be Japanese in hiragana/katakana with NO kanji. Flag any kanji as a page issue.\n' : ''}
If ANY of these fail (arcCoherence < 6, readAloudRhythm < 6, lastPageLanding false, soundOverload true, agency < 6, any page captionRisk >= 7, or any page deliversBeat false), write "feedback": a numbered list of specific corrections. Reference page numbers. Say exactly what is wrong and what a fix looks like — do not write replacement text yourself.

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
          deliversBeat: {
            type: 'boolean',
            description:
              "Does this page's text do its declared beat's job? true when no beat was declared.",
          },
          issue: {
            type: ['string', 'null'],
            description: 'Specific problem on this page, or null',
          },
        },
        required: ['pageNumber', 'captionRisk', 'deliversBeat', 'issue'],
        additionalProperties: false,
      },
    },
    truthToEvent: {
      type: ['number', 'null'],
      description: '0-10 when an event summary was provided, else null',
    },
    soundOverload: {
      type: ['boolean', 'null'],
      description:
        "true if the story leans on sound words (2+ on a page, or sound as a page's main event); null if not assessed",
    },
    agency: {
      type: 'number',
      description: '0-10 — is the child the doer with a goal, an obstacle, and a try',
    },
    feedback: {
      type: ['string', 'null'],
      description: 'Numbered corrections if failing, else null',
    },
  },
  required: [
    'arcCoherence',
    'readAloudRhythm',
    'lastPageLanding',
    'pages',
    'truthToEvent',
    'soundOverload',
    'agency',
    'feedback',
  ],
  additionalProperties: false,
} as const;

export interface StoryQCResponse {
  arcCoherence: number;
  readAloudRhythm: number;
  lastPageLanding: boolean;
  pages: {
    pageNumber: number;
    captionRisk: number;
    /** V2: does this page deliver its declared beat? true when no beat declared. */
    deliversBeat: boolean;
    issue: string | null;
  }[];
  truthToEvent: number | null;
  /** Photo judge enforces this; true = the story over-uses sound words. */
  soundOverload: boolean | null;
  /** Log-only at launch — is the child the doer (goal, obstacle, try)? */
  agency: number;
  feedback: string | null;
}

/** Thresholds shared by the worker's pass/fail decision. */
export const STORY_QC_THRESHOLDS = {
  minArcCoherence: 6,
  minReadAloudRhythm: 6,
  maxCaptionRisk: 6, // a page fails at >= 7
  minRefrainEchoes: 3,
  // Age-4 length budget (STORY_QUALITY_V2). Target band is 15-30 words /
  // 1-2 sentences (en) and 20-45 chars (ja); the caps below are the hard
  // enforcement line. No floor — short punchy pages are a feature.
  maxWordsEn: 30,
  maxSentences: 3,
  maxCharsJa: 48,
  // Log-only today: truthToEvent is scored and logged but never triggers a
  // regen. Flip to enforcing only after Railway data validates the
  // distribution (every new failure trigger is a silent extra generation
  // during the parent's wait).
  minTruthToEvent: 6,
  // Log-only (X6d): premiseTruth is scored on AVATAR_STORY books and logged,
  // never enforced — same telemetry-first philosophy as truthToEvent.
  minPremiseTruth: 6,
  // Log-only (X13 S3): agency is scored on BOTH photo and avatar books and
  // logged, never enforced at launch. soundOverload (the sibling S-track
  // check) DOES enforce on photo — it is a boolean flag, no threshold needed.
  // Flip agency to enforcing only after Railway data validates the
  // distribution (every new trigger is a silent extra generation).
  minAgency: 6,
} as const;

// ----------------------------------
// AVATAR STORIES (X6d) — QC variant
// ----------------------------------
//
// AVATAR_STORY books have no photos, so captionRisk (photo-caption smell) is
// meaningless and is dropped. In its place the model scores premiseTruth:
// does the manuscript deliver the parent-picked spark? premiseTruth is
// LOG-ONLY at launch. The enforced dimensions (arc, rhythm, landing, and the
// deterministic refrain count in the worker) are unchanged.

export const AVATAR_STORY_QC_SYSTEM_PROMPT =
  "You are a ruthless children's-book editor reviewing a picture-book manuscript for children ages 3-5 — every book should be a real little adventure with a beginning, a problem, and a satisfying end. This is an invented adventure starring the family's own characters — you evaluate narrative arc, read-aloud rhythm, and whether the story delivers the premise the parent picked. You never rewrite the story yourself — you score it and give precise, actionable corrections.";

export interface AvatarStoryQCInput {
  storyArc: StoryArc;
  pages: {
    pageNumber: number;
    text: string;
    /** V2: the scene the illustrator will draw for this page (scene.action). */
    sceneAction?: string | null;
    /** V2: the scene's focal character+action (scene.focus). */
    sceneFocus?: string | null;
  }[];
  language?: string; // "en" | "ja"
  /** The parent-picked spark the story promised to deliver. */
  premise: string;
  /** Cast names+roles, so the editor can spot missing or invented characters. */
  cast?: { name: string; role: string }[];
  /** STORY QUALITY V2: the per-page structural plan the pages promised to deliver. */
  beatSheet?: BeatSheetEntry[];
}

export function createAvatarStoryQCPrompt(input: AvatarStoryQCInput): string {
  const beats = beatMap(input.beatSheet);
  const pagesBlock = input.pages
    .map((p) => {
      const sceneLine = p.sceneAction
        ? `\n[scene action: ${p.sceneAction}${p.sceneFocus ? `; focus: ${p.sceneFocus}` : ''}]`
        : '';
      return `${pageHeader(p.pageNumber, beats)}\n${p.text}${sceneLine}`;
    })
    .join('\n');

  const castBlock = input.cast?.length
    ? `\n# The cast the parent picked\n${input.cast
        .map((c) => `- ${c.name} (${c.role.replace(/_/g, ' ')})`)
        .join(
          '\n',
        )}\nEvery cast member should matter to the story; no character outside this list may appear.\n`
    : '';

  return `Review this ${input.pages.length}-page picture-book manuscript for children ages 3-5. It is an INVENTED adventure (no photos) starring the family's own characters, built on a premise the parent picked.

# Declared story arc
- Desire: ${input.storyArc.desire}
- Obstacle: ${input.storyArc.obstacle}
- Throughline: ${input.storyArc.throughline}
- Try: ${input.storyArc.tryAndOvercome ?? '(none declared)'}
- Refrain: ${input.storyArc.refrain}
- Emotional peak: ${input.storyArc.emotionalPeak}
- Resolution: ${input.storyArc.resolution}

# The premise the parent picked
"${input.premise}" — the story promised to deliver this.
${castBlock}
# Manuscript
${pagesBlock}
--- End Manuscript ---

Score the manuscript:

1. arcCoherence (0-10): Do the pages actually deliver the declared arc — a desire established early, escalation through the middle, an emotional peak, a soft landing? A flat sequence of disconnected moments scores below 5.
2. readAloudRhythm (0-10): Read it aloud in your head. Varied sentence lengths and musicality score high; leaning on sound words does NOT — a story that reaches for a sound word where a vivid verb or image would do scores below 6. Monotonous subject-verb-object chains score below 5.
3. lastPageLanding (boolean): true only if the final page lands as a soft, warm exhale WITHOUT a summary statement ("What a wonderful day", "それはすてきないちにちでした" and the like are automatic false).
4. premiseTruth (0-10): Does the manuscript deliver the premise above — its promise shapes the desire, the peak, and the landing? A story that could hang off any premise scores below 5.
5. soundOverload (boolean): true if the manuscript leans on sound words — any page that stacks 2+ sound words, or makes a sound word the page's main event. A story that reaches for a sound word where a vivid verb or image would do is overloaded.
6. agency (0-10): Is the child the DOER — one clear goal, a real obstacle, and a try-wobble-try before the payoff? A child who only moves THROUGH a tour of moments (witnessing, not acting) scores below 5.
7. Per page, note a specific "issue" (or null): an invented character, a broken hand-off, a page that stalls the story.
8. Per page, deliversBeat (boolean): each page header declares its beat (role — goal). true only if the page's text actually does that job for the throughline. A lovely page doing a DIFFERENT job is false. If a page shows no beat, set true.
9. Per page, sceneMatchesText (boolean): the [scene action/focus] under a page is what the illustrator will draw. true only if it depicts the SAME moment the text narrates — same action, same focal character. Cast membership is checked elsewhere; judge the ACTION. If a page shows no scene line, set true.
${input.language === 'ja' ? '\n10. The text must be Japanese in hiragana/katakana with NO kanji. Flag any kanji as a page issue.\n' : ''}
If ANY of these fail (arcCoherence < 6, readAloudRhythm < 6, lastPageLanding false, agency < 6, any page deliversBeat false, or any page sceneMatchesText false), write "feedback": a numbered list of specific corrections. Reference page numbers. Say exactly what is wrong and what a fix looks like — do not write replacement text yourself.

BAD feedback:  "Page 3 is weak"
GOOD feedback: "Page 3 stalls — nothing leans into page 4. End it with a glance toward the next thing or a question, so the listener needs the page turn."

If everything passes, set "feedback" to null.`;
}

export const AVATAR_STORY_QC_RESPONSE_SCHEMA = {
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
          deliversBeat: {
            type: 'boolean',
            description:
              "Does this page's text do its declared beat's job? true when no beat was declared.",
          },
          sceneMatchesText: {
            type: 'boolean',
            description:
              "Does the page's scene depict the same moment its text narrates? true when no scene was shown.",
          },
          issue: {
            type: ['string', 'null'],
            description: 'Specific problem on this page, or null',
          },
        },
        required: ['pageNumber', 'deliversBeat', 'sceneMatchesText', 'issue'],
        additionalProperties: false,
      },
    },
    premiseTruth: {
      type: 'number',
      description: '0-10 — does the manuscript deliver the parent-picked premise',
    },
    soundOverload: {
      type: ['boolean', 'null'],
      description:
        "true if the story leans on sound words (2+ on a page, or sound as a page's main event); null if not assessed",
    },
    agency: {
      type: 'number',
      description: '0-10 — is the child the doer with a goal, an obstacle, and a try',
    },
    feedback: {
      type: ['string', 'null'],
      description: 'Numbered corrections if failing, else null',
    },
  },
  required: [
    'arcCoherence',
    'readAloudRhythm',
    'lastPageLanding',
    'pages',
    'premiseTruth',
    'soundOverload',
    'agency',
    'feedback',
  ],
  additionalProperties: false,
} as const;

export interface AvatarStoryQCResponse {
  arcCoherence: number;
  readAloudRhythm: number;
  lastPageLanding: boolean;
  pages: {
    pageNumber: number;
    /** V2: does this page deliver its declared beat? true when no beat declared. */
    deliversBeat: boolean;
    /** V2: does scene.action/focus depict the text's moment? true when no scene shown. */
    sceneMatchesText: boolean;
    issue: string | null;
  }[];
  premiseTruth: number;
  /** Log-only on avatar (photo enforces); true = the story over-uses sound words. */
  soundOverload: boolean | null;
  /** Log-only — is the child the doer (goal, obstacle, try)? */
  agency: number;
  feedback: string | null;
}

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
    return pageTexts.filter((text) => {
      const compactPage = normalize(text).replace(/ /g, '');
      for (const run of runs) {
        if (compactPage.includes(run)) return true;
      }
      return false;
    }).length;
  }

  const words = cleanRefrain.split(' ').filter((w) => w.length > 2);
  if (words.length === 0) return 0;
  const needed = Math.ceil(words.length / 2);
  return pageTexts.filter((text) => {
    const page = ` ${normalize(text)} `;
    const hits = words.filter((w) => page.includes(` ${w} `)).length;
    return hits >= needed;
  }).length;
}

const KANJI_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/; // CJK ideographs (ext A, unified, compat)
const KANA_RE = /[\u3040-\u30FF]/; // hiragana + katakana (incl. ー at U+30FC)
const LATIN_RE = /[A-Za-z\u00C0-\u024F]/; // ASCII + Latin-1/Extended letters

/**
 * Script gate for the deterministic childName check.
 *
 * A raw-substring check is only meaningful when the name's script matches
 * the book language: the ja prompt forbids kanji (a kanji name would be
 * rendered as its reading, which we don't know) and transliterates clearly
 * non-Japanese names to katakana (so a Latin name never appears verbatim in
 * a ja book). Cross-script or kanji names must be skipped — an enforcing
 * check there would burn the single regen on an unwinnable correction.
 */
export function isChildNameCheckable(childName: string, language: string = 'en'): boolean {
  if (KANJI_RE.test(childName)) return false;
  const hasKana = KANA_RE.test(childName);
  const hasLatin = LATIN_RE.test(childName);
  if (language === 'ja') return hasKana && !hasLatin;
  return hasLatin && !hasKana;
}

export interface ChildNameEchoes {
  /** Pages whose text contains the child's name. */
  pagesWithName: number;
  /** Whether the name appears in the landing (final ~20% of pages). */
  nameInLanding: boolean;
}

/**
 * Count pages that mention the child by name. Deterministic — no model call.
 * Latin names match on word boundaries ("Sam" must not match "Samantha");
 * kana names match as plain substrings (ja text has no reliable word
 * boundaries and particles attach directly, e.g. "えまが").
 *
 * Callers must gate with isChildNameCheckable first — a cross-script name
 * makes these counts meaningless.
 */
export function countChildNameEchoes(childName: string, pageTexts: string[]): ChildNameEchoes {
  const name = normalize(childName);
  if (!name || pageTexts.length === 0) return { pagesWithName: 0, nameInLanding: false };

  const latin = LATIN_RE.test(name);
  const compactName = name.replace(/ /g, '');
  const matches = (text: string): boolean => {
    const page = normalize(text);
    return latin ? ` ${page} `.includes(` ${name} `) : page.replace(/ /g, '').includes(compactName);
  };

  const flags = pageTexts.map(matches);
  const landingSize = Math.max(1, Math.ceil(pageTexts.length * 0.2));
  return {
    pagesWithName: flags.filter(Boolean).length,
    nameInLanding: flags.slice(pageTexts.length - landingSize).some(Boolean),
  };
}

/**
 * LOG-ONLY: occurrences of one parent-supplied learning word across page
 * texts (page-level presence count, mirroring countRefrainEchoes semantics).
 * Latin words match on normalized word boundaries; CJK on compact substrings.
 */
export function countLearningWordEchoes(
  word: string,
  pageTexts: string[],
  language: string = 'en',
): number {
  const clean = normalize(word);
  if (!clean) return 0;
  // A Latin-script word gets boundary matching only where the surrounding
  // text HAS word boundaries; inside ja prose, substring matching is safer.
  const latin = language !== 'ja' && /[A-Za-zÀ-ɏ]/.test(clean);
  return pageTexts.filter((text) => {
    const page = normalize(text);
    return latin
      ? ` ${page} `.includes(` ${clean} `)
      : page.replace(/ /g, '').includes(clean.replace(/ /g, ''));
  }).length;
}

// ----------------------------------
// STORY QUALITY V2 — deterministic length + name checks
// ----------------------------------

/** Whitespace-token word count (en). Dash-joined tokens count once. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// Unlike normalize(), keeps the long-vowel mark ー — it is part of the word
// and must count toward the ja length budget.
const JA_STRIP_RE = /[\s.,!?;:'"“”‘’«»„…—–\-()[\]{}、。！？「」『』・〜]/g;

/** Character count excluding whitespace and punctuation (ja length budget). */
export function countJaChars(text: string): number {
  return text.replace(JA_STRIP_RE, '').length;
}

/**
 * Sentence count via terminator groups ("What?!" is one sentence).
 * Non-empty text without a terminator still reads as one sentence.
 */
export function countSentences(text: string, language: string = 'en'): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const terminators = language === 'ja' ? /[。！？…!?.]+/g : /[.!?…]+/g;
  const groups = trimmed.match(terminators)?.length ?? 0;
  const endsTerminated = (language === 'ja' ? /[。！？…!?.]\s*$/ : /[.!?…]\s*$/).test(trimmed);
  return groups + (endsTerminated ? 0 : 1);
}

export interface WordBudgetProblem {
  pageNumber: number;
  issue: string;
}

/**
 * Hard length caps per page (en words / ja characters, plus a shared
 * sentence cap). Deterministic — runs before the QC model call so regen
 * feedback carries exact counts. One problem per page (worst first).
 */
export function wordBudgetProblems(
  pages: { pageNumber: number; text: string }[],
  language: string = 'en',
): WordBudgetProblem[] {
  const problems: WordBudgetProblem[] = [];
  for (const page of pages) {
    if (language === 'ja') {
      const chars = countJaChars(page.text);
      if (chars > STORY_QC_THRESHOLDS.maxCharsJa) {
        problems.push({
          pageNumber: page.pageNumber,
          issue: `Page ${page.pageNumber} runs ${chars} characters (cap ${STORY_QC_THRESHOLDS.maxCharsJa}) — rewrite to the 20-45 character band.`,
        });
        continue;
      }
    } else {
      const words = countWords(page.text);
      if (words > STORY_QC_THRESHOLDS.maxWordsEn) {
        problems.push({
          pageNumber: page.pageNumber,
          issue: `Page ${page.pageNumber} runs ${words} words (cap ${STORY_QC_THRESHOLDS.maxWordsEn}) — rewrite to 1-2 sentences, 15-30 words.`,
        });
        continue;
      }
    }
    const sentences = countSentences(page.text, language);
    if (sentences > STORY_QC_THRESHOLDS.maxSentences) {
      problems.push({
        pageNumber: page.pageNumber,
        issue: `Page ${page.pageNumber} has ${sentences} sentences (cap ${STORY_QC_THRESHOLDS.maxSentences}) — merge into 1-2 sentences.`,
      });
    }
  }
  return problems;
}

export interface NameGarble {
  pageNumber: number;
  snippet: string;
}

// Connectors that turn two adjacent cast names into a garble ("Trex the
// Kai"). Legit joins (and, with, commas, sentence breaks, possessives)
// never flag.
const GARBLE_CONNECTORS = new Set(['the', 'a', 'an', 'of']);

interface GarbleToken {
  /** Token with surrounding punctuation stripped (keeps internal apostrophes). */
  core: string;
  /** Lowercased core without a possessive 's. */
  word: string;
  possessive: boolean;
  /** Trailing punctuation (comma, period, dash…) breaks adjacency. */
  breaksAfter: boolean;
}

/**
 * Detect two DISTINCT roster names mashed together — directly adjacent or
 * joined only by the/a/an/of — the exact class of the shipped
 * "Trex the Kai" bug. High precision by design: any punctuation between
 * tokens, a possessive first name, or a legit connector word clears it.
 * ja books are skipped (no reliable word boundaries).
 */
export function findNameGarbles(
  pages: { pageNumber: number; text: string }[],
  rosterNames: string[],
  language: string = 'en',
): NameGarble[] {
  if (language === 'ja') return [];
  const names = new Set<string>();
  for (const name of rosterNames) {
    const clean = name.trim().toLowerCase();
    // Only single-token names can garble by adjacency.
    if (clean && !clean.includes(' ')) names.add(clean);
  }
  if (names.size === 0) return [];

  const garbles: NameGarble[] = [];
  for (const page of pages) {
    const tokens: GarbleToken[] = page.text
      .split(/\s+/)
      .filter(Boolean)
      .map((raw) => {
        const lead = raw.replace(/^[^\p{L}\p{N}'’]+/u, '');
        const core = lead.replace(/[^\p{L}\p{N}'’]+$/u, '');
        const possessive = /['’]s$/i.test(core);
        return {
          core,
          word: core.replace(/['’]s$/i, '').toLowerCase(),
          possessive,
          breaksAfter: core !== lead,
        };
      });

    for (let i = 0; i < tokens.length; i++) {
      const first = tokens[i];
      if (!names.has(first.word) || first.possessive || first.breaksAfter) continue;
      const next = tokens[i + 1];
      if (!next) continue;
      if (names.has(next.word) && next.word !== first.word) {
        garbles.push({ pageNumber: page.pageNumber, snippet: `${first.core} ${next.core}` });
        continue;
      }
      const after = tokens[i + 2];
      if (
        after &&
        GARBLE_CONNECTORS.has(next.word) &&
        !next.possessive &&
        !next.breaksAfter &&
        names.has(after.word) &&
        after.word !== first.word
      ) {
        garbles.push({
          pageNumber: page.pageNumber,
          snippet: `${first.core} ${next.core} ${after.core}`,
        });
      }
    }
  }
  return garbles;
}

export interface RollCallProblem {
  pageNumber: number;
  namesFound: string[];
}

/**
 * LOG-ONLY: pages where more than maxNames roster names appear — the
 * "roll-call prose" smell (every character doing something every page).
 */
export function rollCallProblems(
  pages: { pageNumber: number; text: string }[],
  rosterNames: string[],
  maxNames: number = 3,
): RollCallProblem[] {
  const problems: RollCallProblem[] = [];
  for (const page of pages) {
    const pageText = ` ${normalize(page.text)} `;
    const compactPage = pageText.replace(/ /g, '');
    const found = rosterNames.filter((name) => {
      const clean = normalize(name);
      if (!clean) return false;
      return LATIN_RE.test(clean)
        ? pageText.includes(` ${clean} `)
        : compactPage.includes(clean.replace(/ /g, ''));
    });
    if (found.length > maxNames) {
      problems.push({ pageNumber: page.pageNumber, namesFound: found });
    }
  }
  return problems;
}
