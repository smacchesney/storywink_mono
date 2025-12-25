// ----------------------------------
// IMPORTS & TYPES
// ----------------------------------

import { convertHeicToJpeg } from '../utils.js';

// Content types for OpenAI Responses API (GPT-5.1)
// Using explicit types that match OpenAI SDK expectations
type InputText = { type: 'input_text'; text: string };
type InputImage = { type: 'input_image'; image_url: string; detail: 'low' | 'high' | 'auto' };
type MessageContentPart = InputText | InputImage;

// JSON Schema for structured story response output
export const STORY_RESPONSE_SCHEMA = {
  type: 'object',
  description: 'Story text and illustration notes for each page, keyed by page number',
  properties: {}, // Required by OpenAI - empty because we use dynamic keys via additionalProperties
  additionalProperties: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The story text for this page (1-3 sentences, max 35 words)'
      },
      illustrationNotes: {
        type: ['string', 'null'],
        description: 'Visual effects suggestion for the illustration, or null if none'
      }
    },
    required: ['text', 'illustrationNotes'],
    additionalProperties: false
  }
} as const;

// Simplified Input Type - Expects pre-filtered/sorted pages
export interface StoryGenerationInput {
  bookTitle: string;
  isDoubleSpread: boolean;
  artStyle?: string;
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
  "You are an expert children's picture‑book author for toddlers (ages 2-4). Parents will read this story aloud to their children. Your task is to write engaging, age-appropriate story text for a personalised picture book based on the user's photos and inputs.";

// ----------------------------------
// STORY GENERATION – VISION PROMPT
// ----------------------------------

export function createVisionStoryGenerationPrompt(
  input: StoryGenerationInput
): MessageContentPart[] {
  const msg: MessageContentPart[] = [];

  // ---------- CONFIG ----------
  msg.push({
    type: 'input_text',
    text: `# Configuration\nBook Title: ${
      input.bookTitle || 'My Special Story'
    }\nPage Count: ${input.storyPages.length}`,
  });

  // ---------- STORYBOARD (IMAGES) ----------
  msg.push({ type: 'input_text', text: '# Storyboard Sequence' });

  input.storyPages.forEach((page) => {
    msg.push({ type: 'input_text', text: `--- Page ${page.pageNumber} ---` });
    if (page.originalImageUrl) {
      // Convert HEIC to JPEG for OpenAI compatibility
      const convertedUrl = convertHeicToJpeg(page.originalImageUrl);
      msg.push({
        type: 'input_image',
        image_url: convertedUrl,
        detail: 'high',
      });
    } else {
      msg.push({
        type: 'input_text',
        text: `[No Image Provided for Page ${page.pageNumber}]`,
      });
    }
  });
  msg.push({ type: 'input_text', text: '--- End Storyboard ---' });

  // ---------- INSTRUCTIONS ----------
  const characterInstruction = `  - Use descriptive terms like "the child", "the little one", etc.`;

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
    `\n- For **each** page, also suggest \"illustrationNotes\" to dynamically enhance the image with fun effects:`,
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
    `  - If no dynamic effect fits, set \"illustrationNotes\" to null or empty.`,
    `\n- Effects must feel playful but natural, blending into the scene without overwhelming it.`,
    `\n- Final Output:`,
    `\nReturn ONLY a valid JSON object. The keys must be page numbers as strings (e.g., \"1\", \"2\"). The value for each key must be an object with two keys: \"text\" (string, the story text) and \"illustrationNotes\" (string or null, the visual suggestion).`,
    `Example format: {\"1\":{\"text\":\"Sample text...\",\"illustrationNotes\":\"Suggestion...\"},\"2\":{\"text\":\"More text...\",\"illustrationNotes\":null}}`
  ].join('');

  msg.push({
    type: 'input_text',
    text: `${baseInstructions}\n${illustrationNotesInstructions}`,
  });

  return msg;
}

// Export types for response parsing
export interface StoryPageResponse {
  text: string;
  illustrationNotes?: string | null;
}

export interface StoryResponse {
  [pageNumber: string]: StoryPageResponse;
}

// Backwards compatibility alias (deprecated)
export type WinkifyStoryResponse = StoryResponse;