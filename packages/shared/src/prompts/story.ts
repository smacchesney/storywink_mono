// ----------------------------------
// IMPORTS & TYPES
// ----------------------------------

// Prompt part types for multi-modal story generation
export interface TextPart { text: string }
export interface ImagePlaceholder {
  type: 'image_placeholder';
  imageUrl: string;
  pageNumber: number;
}
export type StoryPromptPart = TextPart | ImagePlaceholder;

// Backwards compatibility aliases
/** @deprecated Use TextPart instead */
export type GeminiTextPart = TextPart;
/** @deprecated Use ImagePlaceholder instead */
export type GeminiImagePlaceholder = ImagePlaceholder;

// JSON Schema for OpenAI structured output (strict mode)
// Array-based format: { pages: [{ pageNumber, text, illustrationNotes }, ...] }
export const STORY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    storyArc: {
      type: 'object',
      description: 'Plan the story arc BEFORE writing pages — this shapes the narrative',
      properties: {
        desire: {
          type: 'string',
          description: 'What does the child want, discover, or set out to do? (1 sentence)',
        },
        refrain: {
          type: 'string',
          description: 'A 4-8 word phrase that will recur 3+ times with variation throughout the story',
        },
        emotionalPeak: {
          type: 'string',
          description: 'The moment of biggest feeling — wonder, triumph, laughter, or warmth (1 sentence)',
        },
        resolution: {
          type: 'string',
          description: 'How does the story land? What feeling does the child carry into sleep? (1 sentence)',
        },
      },
      required: ['desire', 'refrain', 'emotionalPeak', 'resolution'],
      additionalProperties: false,
    },
    pages: {
      type: 'array',
      description: 'Story text and illustration notes for each page',
      items: {
        type: 'object',
        properties: {
          pageNumber: {
            type: 'number',
            description: 'The 1-based page number'
          },
          text: {
            type: 'string',
            description: 'The story text for this page (2-4 sentences, max 50 words)'
          },
          illustrationNotes: {
            type: ['string', 'null'],
            description: 'Visual effects suggestion for the illustration, or null if none'
          }
        },
        required: ['pageNumber', 'text', 'illustrationNotes'],
        additionalProperties: false,
      }
    }
  },
  required: ['storyArc', 'pages'],
  additionalProperties: false,
} as const;

// Simplified Input Type - Expects pre-filtered/sorted pages
export interface StoryGenerationInput {
  bookTitle: string;
  isDoubleSpread: boolean;
  artStyle?: string;
  childName?: string;
  additionalCharacters?: { name: string; relationship: string }[];
  tone?: string; // Story mood e.g. "adventurous", "silly", "sweet"
  theme?: string; // Story context e.g. "Our trip to the beach"
  language?: string; // "en" | "ja", defaults to "en"
  storyPages: {
    pageId: string;
    pageNumber: number;
    assetId: string | null;
    originalImageUrl: string | null;
  }[];
}

// ----------------------------------
// SYSTEM PROMPT (StoryGen)
// ----------------------------------

export const STORY_GENERATION_SYSTEM_PROMPT = `You are an expert children's picture-book author for toddlers (ages 2-4). Parents read your stories aloud at bedtime.

CRITICAL MINDSET — You are a STORYTELLER, not a photo captioner:
- Photos are INSPIRATION, not subjects. A photo of a child at the park should spark a narrative moment (wonder, mischief, discovery) — NOT a description of "a child standing in the park."
- Every page must advance the STORY — an emotional journey with desire, tension, and resolution.
- If you find yourself describing what's visible in a photo, STOP and rewrite from the child's inner experience.

Your north star: Would a parent want to re-read this 100 times? That requires emotional truth, rhythm, and a refrain worth repeating.`;

// ----------------------------------
// STORY GENERATION PROMPT
// ----------------------------------

export function createStoryGenerationPrompt(
  input: StoryGenerationInput
): StoryPromptPart[] {
  const parts: StoryPromptPart[] = [];

  // ---------- CONFIG ----------
  parts.push({
    text: `# Configuration\nBook Title: ${
      input.bookTitle || 'My Special Story'
    }\nPage Count: ${input.storyPages.length}`,
  });

  // ---------- STORYBOARD (IMAGES) ----------
  parts.push({ text: '# Storyboard Sequence' });

  input.storyPages.forEach((page) => {
    parts.push({ text: `--- Page ${page.pageNumber} ---` });
    if (page.originalImageUrl) {
      parts.push({
        type: 'image_placeholder',
        imageUrl: page.originalImageUrl,
        pageNumber: page.pageNumber,
      });
    } else {
      parts.push({
        text: `[No Image Provided for Page ${page.pageNumber}]`,
      });
    }
  });
  parts.push({ text: '--- End Storyboard ---' });

  // ---------- INSTRUCTIONS ----------
  // Build character instruction dynamically based on provided names
  let characterInstruction: string;
  if (input.childName) {
    characterInstruction = `  - The main character is named "${input.childName}". Use this name directly in the story text.`;
    if (input.additionalCharacters && input.additionalCharacters.length > 0) {
      const charList = input.additionalCharacters
        .map(c => `"${c.name}" (${c.relationship})`)
        .join(', ');
      characterInstruction += `\n  - Other characters who may appear: ${charList}. Identify which characters appear in each photo and use their names appropriately.`;
    }
  } else {
    // Fallback to generic terms if no child name provided
    characterInstruction = `  - Use descriptive terms like "the child", "the little one", etc.`;
  }

  const baseInstructions = [
    `# Instructions & Guiding Principles:`,
    `- Imagine a parent curled up with their toddler at bedtime, reading aloud. Every sentence should feel warm, playful, and alive in a parent's voice.`,
    `- Write from the **toddler's perspective** — what they see, feel, touch, hear, and wonder about. Ground every moment in their sensory experience.`,
    ``,
    `## ANTI-CAPTION RULE (critical):`,
    `- NEVER describe what's literally visible in the photo like a caption. Instead, narrate what the child FEELS, IMAGINES, or DISCOVERS in that moment.`,
    `- BAD: "Kai is at the beach. He sees the waves." (this is a caption)`,
    `- GOOD: "The waves whisper a secret — come closer, come closer! Kai wiggles his toes in the sand." (this is a story)`,
    `- Each page must contain at least one element that goes BEYOND the photo: an internal feeling, a question, a sensory detail, or an imaginative leap.`,
    ``,
    `## Narrative Architecture (OPENING → BUILDING → LANDING):`,
    `- **OPENING** (first ~20% of pages): Establish the child's world AND a small desire or question. What do they want, wonder about, or set out to do? Hook the listener.`,
    `- **BUILDING** (middle ~60%): The desire meets the world. Each page should ESCALATE — new discoveries, small obstacles, mounting excitement or tenderness. This is where the refrain repeats and evolves.`,
    `- **LANDING** (final ~20%): The emotional peak resolves into warmth and safety. The last page should feel like a soft exhale — a sentence a parent lingers on before closing the book.`,
    `- NEVER end with "What a wonderful day" or similar summary statements. Let the accumulated feeling speak for itself.`,
    ``,
    `## Recurring Refrain (REQUIRED):`,
    `- Create a short phrase (4-8 words) that echoes through the story at least 3 times.`,
    `- Vary it slightly each time — change one word, add emphasis, or whisper it the last time.`,
    `- Great refrains feel like a heartbeat: "Splish, splash, one more splash!" → "Splish, splash, the biggest splash!" → "Splish... splash... goodnight, little splash."`,
    `- Report this phrase in the "storyArc.refrain" field.`,
    ``,
    `## Voice & Rhythm (critical for read-aloud quality):`,
    `- **Vary sentence structure**: mix short punchy fragments ("Splish!") with slightly longer flowing sentences. Avoid monotonous Subject-Verb-Object patterns.`,
    `- **Onomatopoeia and sound words** should feel organic to the scene — rumble, swoosh, crunch, pitter-pat — not forced.`,
    `- Sentences should have a **musical quality** when read aloud — rhythm matters more than vocabulary.`,
    `- Use concrete nouns and action verbs. No abstractions. One idea per sentence.`,
    ``,
    `## Dialogic Moments:`,
    `- Include 2-3 questions across the whole book that invite the listening child to participate: "Can you see...?", "What do you think happens next?", "How many splashes was that?"`,
    `- Place these naturally — never more than one per page, and never on the final page.`,
    ``,
    `## Emotional Texture:`,
    `- Capture the **small moments** that make a toddler's day magical — the wonder of a new texture, the thrill of a puddle, the safety of a parent's hand.`,
    `- Show emotions through **actions and senses**, not labels: instead of "Kai was happy", write "Kai's eyes go wide. He squeezes Mama's hand tight."`,
    `- Include **gentle humor** — mild mischief, silly surprises, funny sounds.`,
    ``,
    `## Characters:`,
    characterInstruction,
    `  - Book Title: \"${input.bookTitle || '(Not Provided)'}\"`,
    ``,
    ...(input.tone ? [
      `## Story Mood:`,
      `- Write this story with a **"${input.tone}"** feel throughout. Let this mood guide word choice, pacing, and energy level.`,
      ``,
    ] : []),
    ...(input.theme ? [
      `## Story Context:`,
      `- The parent described this story as: **"${input.theme}"**. Weave this context into the narrative — it should inform the story arc, not just be mentioned once.`,
      ``,
    ] : []),
    `## Length:`,
    `- **2-4 sentences per page, maximum 50 words** (for the ${input.storyPages.length} pages provided).`,
    `  - This 50 word limit is STRICT — text is displayed on its own page but must stay concise for toddler attention spans.`,
    `  - Vary length across pages for rhythm: some pages deserve a single punchy line, others need a beat more.`
  ].join('\n');

  // Language-specific instructions (appended when not English)
  const languageInstruction = input.language === 'ja'
    ? [
        `\n## Language — Japanese (日本語):`,
        `- Write ALL story text ("text" field) in **Japanese**.`,
        `- Use **hiragana** primarily, as this book is for toddlers (ages 2-4). **No kanji at all.** Katakana is OK for onomatopoeia and foreign words.`,
        `- Maintain the same warm, playful, read-aloud quality described above, adapted for Japanese.`,
        `- Use Japanese onomatopoeia naturally (ざぶーん, どきどき, ぴょんぴょん, きらきら, etc.).`,
        `- Character names should remain as provided (do not transliterate to katakana unless they are clearly non-Japanese names).`,
        `- **Length constraint (replaces the English rule above):** 2-4 sentences per page, **maximum 80 characters** per page.`,
        `- The "illustrationNotes" field must remain in **English** (the illustration AI only understands English).`,
      ].join('\n')
    : '';

  const illustrationNotesInstructions = [
    `\n- For **each** page, also suggest "illustrationNotes" to dynamically enhance the image with fun effects:`,
    `  - Focus on **amplifying the specific action in the scene**:`,
    `    - Movement/Running: motion lines, speed streaks, "ZOOM!", "WHOOSH!"`,
    `    - Water/Splashing: water droplets, ripples, "SPLASH!", "SPLISH!"`,
    `    - Eating/Food: "YUM!", "MUNCH!", "CHOMP!", steam wisps, crumbs flying`,
    `    - Jumping/Flying: arc trails, "BOING!", "WHEEE!"`,
    `    - Surprise/Discovery: subtle glow, "WOW!", "OOOOH!"`,
    `    - Hugging/Love: small floating hearts (2-3 max)`,
    `  - Use sparkles ONLY for actual magic/wonder moments, not as a default effect.`,
    `  - Match the effect to the specific action - if a kid is eating, suggest food effects, not sparkles.`,
    `  - NEVER alter faces, poses, or introduce new characters.`,
    `  - **Specifically for illustrationNotes ONLY:** Use visual language (e.g., 'the boy in red', 'the girl with pigtails') instead of character names. The illustration AI doesn't know names.`,
    `  - If no dynamic effect fits, set "illustrationNotes" to null or empty.`,
    `\n- Effects must feel playful but natural, blending into the scene without overwhelming it.`,
    `\n- Final Output:`,
    `\nReturn ONLY a valid JSON object with a "storyArc" object AND a "pages" array. Plan the storyArc FIRST (desire, refrain, emotionalPeak, resolution), then write pages that follow that arc.`,
    `Each page element must have "pageNumber" (number), "text" (string), and "illustrationNotes" (string or null).`,
    `Example format: {"storyArc":{"desire":"...","refrain":"...","emotionalPeak":"...","resolution":"..."},"pages":[{"pageNumber":1,"text":"Sample text...","illustrationNotes":"Suggestion..."}]}`
  ].join('');

  parts.push({
    text: `${baseInstructions}${languageInstruction}\n${illustrationNotesInstructions}`,
  });

  return parts;
}

// Backwards compatibility alias
/** @deprecated Use createStoryGenerationPrompt instead */
export const createVisionStoryGenerationPrompt = createStoryGenerationPrompt;

// Export types for response parsing
export interface StoryPageResponse {
  pageNumber: number;
  text: string;
  illustrationNotes?: string | null;
}

export interface StoryArc {
  desire: string;
  refrain: string;
  emotionalPeak: string;
  resolution: string;
}

export interface StoryResponse {
  storyArc: StoryArc;
  pages: StoryPageResponse[];
}

// Backwards compatibility alias (deprecated)
export type WinkifyStoryResponse = StoryResponse;
