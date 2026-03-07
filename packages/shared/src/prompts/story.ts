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
  required: ['pages'],
  additionalProperties: false,
} as const;

// Simplified Input Type - Expects pre-filtered/sorted pages
export interface StoryGenerationInput {
  bookTitle: string;
  isDoubleSpread: boolean;
  artStyle?: string;
  childName?: string;
  additionalCharacters?: { name: string; relationship: string }[];
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

export const STORY_GENERATION_SYSTEM_PROMPT =
  "You are an expert children's picture\u2011book author for toddlers (ages 2-4). Parents will read this story aloud to their children. Your task is to write engaging, age-appropriate story text for a personalised picture book based on the user's photos and inputs.";

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
    `- Craft a **cohesive story** matching the provided sequence of user-uploaded images, with a **clear beginning, middle, and end**.`,
    `- Write from the **toddler's perspective** — what they see, feel, touch, hear, and wonder about. Ground every moment in their sensory experience.`,
    ``,
    `## Voice & Rhythm (critical for read-aloud quality):`,
    `- **Vary sentence structure**: mix short punchy fragments ("Splish!") with slightly longer flowing sentences. Avoid monotonous Subject-Verb-Object patterns.`,
    `- **Use questions and exclamations** to pull the listener in: "What's that sound?", "Look!", "Can you guess what happens next?"`,
    `- **Onomatopoeia and sound words** should feel organic to the scene — rumble, swoosh, crunch, pitter-pat — not forced.`,
    `- **Repetition with variation** builds anticipation: repeat a phrase across pages but change one element each time.`,
    `- Sentences should have a **musical quality** when read aloud — rhythm matters more than vocabulary.`,
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
    `\nReturn ONLY a valid JSON object with a "pages" array. Each element must have "pageNumber" (number), "text" (string), and "illustrationNotes" (string or null).`,
    `Example format: {"pages":[{"pageNumber":1,"text":"Sample text...","illustrationNotes":"Suggestion..."},{"pageNumber":2,"text":"More text...","illustrationNotes":null}]}`
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

export interface StoryResponse {
  pages: StoryPageResponse[];
}

// Backwards compatibility alias (deprecated)
export type WinkifyStoryResponse = StoryResponse;
