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
 * Creates a prompt for the gpt-image-1 model to apply artistic style to content images
 * Note: gpt-image-1 uses image inputs directly, not URLs in the prompt
 */
export function createIllustrationPrompt(opts: IllustrationPromptOptions): string {
  const styleDefinition = getStyleDefinition(opts.style);
  const styleDescription = styleDefinition?.description;

  // Base instructions for style transfer
  const base = [
    `Task: Apply the artistic style from the second input image (Style Reference) to the content of the first input image (Content Source).`,
    `Content Source (Image 1): Use this image EXCLUSIVELY for all content elements: characters, objects, faces, poses, and the overall background layout. Preserve these content elements and their composition exactly as they appear in Image 1. Do not add, remove, or significantly alter any content from Image 1.`,
    `Style Source (Image 2): Use this image PURELY as the visual reference for the artistic style. Apply its color palette, texture, line work, shading, rendering techniques, and overall aesthetic faithfully to the content derived from Image 1. DO NOT ADD COMPOSITION ELEMENTS FROM IMAGE 2. The style should ONLY come from Image 2.${styleDescription ? ` Specific Style Notes: ${styleDescription}` : ''}`,
  ];

  // Winkify dynamic effects (if enabled and notes provided)
  const winkifyBits = opts.isWinkifyEnabled && opts.illustrationNotes
    ? [
        'Subtle Dynamic Effects: Enhance the action with visual effects like zoom lines, motion blur, confetti bursts, or onomatopoeia text overlays (e.g., "Whoosh!", "Crunch!", "Splash!", "Zoom!"). These effects should cover less than 20% of the scene and must NOT alter the core characters, faces, or poses derived from Image 1. Apply all effects in the artistic style derived from Image 2.',
        `Specific Effect Request: ${opts.illustrationNotes}.`,
      ]
    : [];

  // Title page vs story page text handling
  const titleBits = opts.isTitlePage
    ? [
        `Book Title Integration: Integrate the book title "${opts.bookTitle}" naturally within the scene. Ensure it is highly legible and does not obscure key details from Image 1 content. The title's visual style (font, color, placement) should be inspired by text elements or the overall aesthetic found in the Style Source (Image 2).`,
      ]
    : [
        `Text Rendering: Render the following text exactly once within the image: "${(opts.pageText ?? '').trim()}". Replicate the exact font style, size, color, and positioning characteristics demonstrated by the text elements present in the Style Source (Image 2). Ensure all provided text is fully visible and not cut off.`,
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
  return `Task: Apply the artistic style from the second input image (Style Reference) to the content of the first input image (Content Source).`;
}

export function buildContentPreservationSection(): string {
  return `Content Source (Image 1): Use this image EXCLUSIVELY for all content elements: characters, objects, faces, poses, and the overall background layout. Preserve these content elements and their composition exactly as they appear in Image 1. Do not add, remove, or significantly alter any content from Image 1.`;
}

export function buildStyleApplicationSection(styleDescription?: string | null): string {
  return `Style Source (Image 2): Use this image PURELY as the visual reference for the artistic style. Apply its color palette, texture, line work, shading, rendering techniques, and overall aesthetic faithfully to the content derived from Image 1. DO NOT ADD COMPOSITION ELEMENTS FROM IMAGE 2. The style should ONLY come from Image 2.${styleDescription ? ` Specific Style Notes: ${styleDescription}` : ''}`;
}

export function buildWinkifySection(illustrationNotes: string): string {
  return `Subtle Dynamic Effects: Enhance the action with visual effects like zoom lines, motion blur, confetti bursts, or onomatopoeia text overlays (e.g., "Whoosh!", "Crunch!", "Splash!", "Zoom!"). These effects should cover less than 20% of the scene and must NOT alter the core characters, faces, or poses derived from Image 1. Apply all effects in the artistic style derived from Image 2. Specific Effect Request: ${illustrationNotes}.`;
}

export function buildTextSection(isTitlePage: boolean, text: string | null, bookTitle: string | null): string {
  if (isTitlePage) {
    return `Book Title Integration: Integrate the book title "${bookTitle}" naturally within the scene. Ensure it is highly legible and does not obscure key details from Image 1 content. The title's visual style (font, color, placement) should be inspired by text elements or the overall aesthetic found in the Style Source (Image 2).`;
  } else {
    return `Text Rendering: Render the following text exactly once within the image: "${(text ?? '').trim()}". Replicate the exact font style, size, color, and positioning characteristics demonstrated by the text elements present in the Style Source (Image 2). Ensure all provided text is fully visible and not cut off.`;
  }
}