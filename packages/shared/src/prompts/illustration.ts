import { StyleKey, getStyleDefinition } from './styles.js';

// ----------------------------------
// TYPES
// ----------------------------------

export interface IllustrationPromptOptions {
  style: StyleKey;
  pageText: string | null;
  bookTitle: string | null;
  isTitlePage?: boolean;
  illustrationNotes?: string | null;
  isWinkifyEnabled?: boolean;
}

// ----------------------------------
// CONSTANTS
// ----------------------------------

const MAX_PROMPT_CHARS = 30000;

// ----------------------------------
// PROMPT BUILDER
// ----------------------------------

/**
 * Creates a prompt for the Gemini 2.5 Flash Image model to apply artistic style to content images
 * Note: Gemini accepts multiple images as input and uses natural language instructions
 */
export function createIllustrationPrompt(opts: IllustrationPromptOptions): string {
  const styleDefinition = getStyleDefinition(opts.style);
  const styleDescription = styleDefinition?.description;

  const base = [
    `Create a children's picture book illustration using the two images provided. The first image shows the scene/subjects, the second image shows the artistic style to apply.`,

    `ARTISTIC STYLE (Primary directive): Fully transform this into a hand-drawn/painted children's book illustration matching the style from the second image. Apply its complete aesthetic: color palette, brush techniques, line work, textures, shading, and lighting approach. The final image must look like it was illustrated from imagination, not like a filtered photograph. Replace all photographic elements (realistic textures, camera lighting, photo grain) with illustrated equivalents. Backgrounds should be simplified into clean illustrated shapes and forms.${styleDescription ? ` Style emphasis: ${styleDescription}` : ''}`,

    `SCENE INTERPRETATION (Secondary directive): Use the first image as reference for: character/subject identity and their pose, the spatial layout and composition, key recognizable objects that establish the setting. Translate these elements into illustration form - a wooden fence becomes illustrated wood with simple line work, not photographic grain; metal becomes clean illustrated surfaces with simple highlights, not realistic reflections. Simplify complex backgrounds into essential illustrated elements while keeping the scene recognizable.`,

    `CHARACTER CONSISTENCY: Maintain the same illustrated appearance of people across all pages - consistent face shape, hair style, skin tone, and proportions in the illustrated style. The child should be immediately recognizable as the same character throughout the book.`,
  ];

  const winkifyBits = opts.isWinkifyEnabled && opts.illustrationNotes
    ? [
        `Dynamic effects: Add subtle visual enhancement like motion lines, sparkles, or comic-style text ("Whoosh!", "Splash!"). Keep minimal (under 20% of image), matching the illustration style. Do not alter character faces or poses.`,
        `Effect note: ${opts.illustrationNotes}`,
      ]
    : [];

  const titleBits = opts.isTitlePage
    ? [
        `Text: Add the title "${opts.bookTitle}" in a readable font matching the second image's text style. Position naturally without covering important subjects. Size appropriately (5-7% of image height).`,
      ]
    : [
        `Text: Add this text once: "${(opts.pageText ?? '').trim()}". Use the same font style and size as the second image (approximately 5-7% of image height for consistency across pages). Match the text aesthetic from the second image. Position text naturally, ensure fully visible and readable.`,
      ];

  const prompt = [...base, ...winkifyBits, ...titleBits]
    .filter(Boolean)
    .join(' ');

  const finalPrompt = prompt.length > MAX_PROMPT_CHARS
    ? prompt.slice(0, MAX_PROMPT_CHARS - 1) + '…'
    : prompt;

  return finalPrompt;
}

// ----------------------------------
// PROMPT SECTIONS (for potential future use)
// ----------------------------------

export function buildTaskSection(): string {
  return `Transform the first image by applying the artistic style from the second image.`;
}

export function buildContentPreservationSection(): string {
  return `Preserve all content from the first image: Keep all characters, people, faces, objects, poses, and the background layout exactly as they appear. Do not add, remove, or change any subjects or elements from the first image.`;
}

export function buildStyleApplicationSection(styleDescription?: string | null): string {
  return `Apply the style from the second image: Transfer its color palette, textures, brush strokes, line work, shading techniques, and overall artistic aesthetic to the content from the first image. Only the visual style should come from the second image, not its composition or content.${styleDescription ? ` Style characteristics to emphasize: ${styleDescription}` : ''}`;
}

export function buildWinkifySection(illustrationNotes: string): string {
  return `Add subtle dynamic visual effects to enhance the action, such as: motion lines, zoom effects, sparkles, confetti, or comic-style text (like "Whoosh!", "Splash!", "Zoom!"). Keep these effects minimal (under 20% of the image) and ensure they do not change the people, faces, or poses from the first image. All effects should match the artistic style from the second image. Specific effect to add: ${illustrationNotes}`;
}

export function buildTextSection(isTitlePage: boolean, text: string | null, bookTitle: string | null): string {
  if (isTitlePage) {
    return `Include the book title in the image: "${bookTitle}". Make it clearly readable and position it naturally within the scene without covering important elements from the first image. Style the text to match the aesthetic of the second image.`;
  } else {
    return `Add this text to the image: "${(text ?? '').trim()}". Render it exactly once, using a font style, size, color, and position that matches any text shown in the second image. Ensure the entire text is visible and not cut off.`;
  }
}