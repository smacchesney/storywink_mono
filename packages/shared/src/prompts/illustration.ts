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
  referenceImageCount?: number; // Number of style reference images (1 for title, 2 for story pages)
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
  const refCount = opts.referenceImageCount || 1;

  // Build image order description: 1 content + N style references
  const imageCountText = refCount === 1
    ? `using the two images provided. The first image shows the scene/subjects, the second image shows the artistic style to apply.`
    : `using the ${1 + refCount} images provided. The first image shows the scene/subjects, the following ${refCount} image(s) show the artistic style to apply. Use all style reference images for comprehensive style matching.`;

  const base = [
    `Create a children's picture book illustration ${imageCountText}`,

    `ARTISTIC STYLE (Primary directive): Fully transform this into a hand-drawn/painted children's book illustration matching the style from the reference image(s). Apply its complete aesthetic: color palette, brush techniques, line work, textures, shading, and lighting approach. The final image must look like a hand-illustrated children's book page, not a filtered photograph—while keeping people precisely recognizable. Replace all photographic elements (realistic textures, camera lighting, photo grain) with illustrated equivalents. Backgrounds should be simplified into clean illustrated shapes and forms.${styleDescription ? ` Style emphasis: ${styleDescription}` : ''}`,

    `SCENE INTERPRETATION (Secondary directive): Use the first image as reference for: character/subject identity and their pose, the spatial layout and composition, key recognizable objects that establish the setting. Translate these elements into illustration form - a wooden fence becomes illustrated wood with simple line work, not photographic grain; metal becomes clean illustrated surfaces with simple highlights, not realistic reflections. Simplify complex backgrounds into essential illustrated elements while keeping the scene recognizable.`,
  ];

  // Character consistency section
  const characterConsistencySection = `PEOPLE - STRICT FIDELITY (non-negotiable):
Every person in the illustration must be immediately recognizable from the source photo.
- Face shape, expression: match the source photo
- Hair color, style, length: exact match to what's visible
- Skin tone: exact match
- Body proportions, clothing: exact match
- If any feature is hidden (hat, angle, shadow): keep it hidden—never invent

FACIAL RENDERING STYLE (critical for consistency across pages):
Render ALL faces using a simplified children's book style as shown in the reference images:
- Eyes: small, simple dots or short curved lines — NOT detailed realistic eyes
- Nose: tiny dot, small L-shape, or simple curved line — minimal and understated
- Mouth: simple curved line for smiles, small open shape for expressions
- Cheeks: soft rosy circles on cheeks for warmth
- Keep facial details minimal and consistent — simpler faces are more consistent across pages
This simplified face style must be applied uniformly to every person (adults and children alike) while still preserving each person's distinguishing features (hair, skin tone, face shape, glasses, facial hair, etc.) so they remain recognizable.

DO NOT reimagine or invent features for any person. A parent must look at your illustration and instantly recognize their child and family.`;

  base.push(characterConsistencySection);

  // Dynamic effects always included when illustrationNotes are provided
  const dynamicEffectsBits = opts.illustrationNotes
    ? [
        `DYNAMIC EFFECTS: Add visual effects to enhance the action. Draw onomatopoeia text (like "SPLASH!", "ZOOM!", "MUNCH!") in the same BLACK PENCIL-SKETCH STYLE shown in the reference images - using black hand-drawn lettering with sketch-like lines and strokes that match the illustration's aesthetic. Keep effects minimal (under 15% of image area) and directly relevant to the scene - avoid generic sparkles unless the scene involves magic or wonder. Do not alter character faces or poses.`,
        `Specific effect to add: ${opts.illustrationNotes}`,
      ]
    : [];

  const titleBits = opts.isTitlePage
    ? [
        `Text: Add the title "${opts.bookTitle}" in a bold, readable hand-drawn font matching the reference images' text style. Use a Coral (#F76C5E) fill color with a black outline/stroke on the lettering. Position naturally without covering important subjects. Size appropriately (5-7% of image height).`,
      ]
    : [
        `COMPOSITION: Fill the entire image canvas with the illustration. No empty space or text areas needed. The illustration should extend to all edges. DO NOT add any text to the image.`,
      ];

  const prompt = [...base, ...dynamicEffectsBits, ...titleBits]
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

export function buildDynamicEffectsSection(illustrationNotes: string): string {
  return `Add visual effects to enhance the action. Draw onomatopoeia text (like "SPLASH!", "ZOOM!", "MUNCH!") in the same BLACK PENCIL-SKETCH STYLE shown in the reference images - using black hand-drawn lettering with sketch-like lines and strokes that match the illustration's aesthetic. Keep effects minimal (under 15% of image area) and directly relevant to the scene. Specific effect to add: ${illustrationNotes}`;
}

export function buildTextSection(isTitlePage: boolean, text: string | null, bookTitle: string | null): string {
  if (isTitlePage) {
    return `Include the book title in the image: "${bookTitle}". Make it clearly readable and position it naturally within the scene without covering important elements from the first image. Use a Coral (#F76C5E) fill color with a black outline/stroke on the lettering, matching the style shown in the reference images.`;
  } else {
    return `Add this text to the image: "${(text ?? '').trim()}". Render it exactly once, using a font style, size, color, and position that matches any text shown in the second image. Ensure the entire text is visible and not cut off.`;
  }
}

