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
            description: 'The story text for this page (1-3 sentences, max 35 words)'
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
    `- You are an award-winning children's book author and illustrator.`,
    `- Your task is to craft a **cohesive and delightful story** matching the provided sequence of user-uploaded images.`,
    `- Each story should have a **clear beginning, middle, and end**, grounded in the sequence order.`,
    `- Write from a **toddler's perspective**, highlighting familiar experiences and relatable emotions (joy, frustration, silliness, pride).`,
    `- Keep sentences **short, simple, and concrete**. Use vivid nouns, strong action verbs, and sensory language.`,
    `- Use **rhythm, repetition, and fun sounds (onomatopoeia)** naturally to enhance read-aloud appeal.`,
    `- Incorporate **gentle, age-appropriate humor** (mild mischief, small surprises) when fitting.`,
    `- **Seamlessly weave in** user details where applicable:`,
    characterInstruction,
    `  - Book Title: \"${input.bookTitle || '(Not Provided)'}\"`,
    `- Generate **1-3 simple sentences per page, maximum 35 words** (for the ${input.storyPages.length} pages provided).`,
    `  - This 35 word limit is STRICT - text will be displayed in a small area.`,
    `  - Adjust slightly across pages to maintain good narrative flow.`
  ].join('\n');

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
    text: `${baseInstructions}\n${illustrationNotesInstructions}`,
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
