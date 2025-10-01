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

  // Core transformation instruction - style takes priority
  const base = [
    `Create a children's picture book illustration by transforming the first image using the artistic style from the second image.`,

    `STYLE APPLICATION (Primary): Fully transform the first image into an illustration. Apply the complete artistic style from the second image: its color palette, textures, brush strokes, line work, shading techniques, lighting style, and overall aesthetic. The result should look like a hand-drawn/painted illustration, not a photo with filters. Remove all photographic elements - realistic lighting, camera effects, textures should be replaced with illustrated equivalents.${styleDescription ? ` Emphasize these style characteristics: ${styleDescription}` : ''}`,

    `CONTENT PRESERVATION (Secondary): While transforming into illustration style, preserve these key elements from the first image: the identity and pose of all people/characters (especially faces - keep them recognizable as the same person but in illustrated form), the main objects and their spatial arrangement, and the general composition. Simplify and abstract background details into clean illustrated elements (e.g., dirt becomes simple ground texture, cluttered areas become simplified shapes) while keeping key recognizable features that establish the setting.`,
  ];

  // Winkify dynamic effects
  const winkifyBits = opts.isWinkifyEnabled && opts.illustrationNotes
    ? [
        `Add subtle dynamic visual effects to enhance the action: motion lines, zoom effects, sparkles, confetti, or comic-style text (like "Whoosh!", "Splash!", "Zoom!"). Keep effects minimal (under 20% of image) and ensure they match the illustration style. Do not alter character faces or poses with these effects.`,
        `Specific effect to add: ${opts.illustrationNotes}`,
      ]
    : [];

  // Text handling with consistency emphasis
  const titleBits = opts.isTitlePage
    ? [
        `Add the book title: "${opts.bookTitle}". Use a font style that matches the second image's text aesthetic. Position it naturally without covering important subjects. Make the text clearly readable and appropriately sized (approximately 5-7% of image height).`,
      ]
    : [
        `Add this text: "${(opts.pageText ?? '').trim()}". Render it exactly once using the same font style, weight, and sizing as shown in the second image. Maintain consistent text size across pages (approximately 5-7% of image height). Position text naturally, ensure it's fully visible and not cut off. The text should integrate with the illustration style.`,
      ];

  // Combine all parts
  const prompt = [...base, ...winkifyBits, ...titleBits]
    .filter(Boolean)
    .join(' ');

  // Ensure prompt doesn't exceed max length
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