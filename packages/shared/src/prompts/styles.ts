// ----------------------------------
// STYLE LIBRARY
// ----------------------------------

/**
 * Context passed to style prompt builders.
 * Contains the page-level data each style needs to construct its prompt.
 */
export interface StylePromptContext {
  bookTitle: string | null;
  pageText: string | null;
  illustrationNotes: string | null;
  referenceImageCount: number;
}

export interface StyleDefinition {
  label: string;
  referenceImageUrls: readonly string[];
  coverReferenceImageUrls?: readonly string[];
  buildInteriorPrompt: (ctx: StylePromptContext) => string;
  buildCoverPrompt: (ctx: StylePromptContext) => string;
}

// ----------------------------------
// HELPER: image ordering text
// ----------------------------------

function imageCountText(refCount: number): string {
  return refCount === 1
    ? `using the two images provided. The first image shows the scene/subjects, the second image shows the artistic style to apply.`
    : `using the ${1 + refCount} images provided. The first image shows the scene/subjects, the following ${refCount} image(s) show the artistic style to apply. Use all style reference images for comprehensive style matching.`;
}

// ----------------------------------
// VIGNETTE STYLE
// ----------------------------------

function vignetteInteriorPrompt(ctx: StylePromptContext): string {
  const refCount = ctx.referenceImageCount || 1;

  const sections = [
    `Create a children's picture book illustration ${imageCountText(refCount)}`,

    `ARTISTIC STYLE (Primary directive): Fully transform this into a hand-drawn/painted children's book illustration matching the style from the reference image(s). Apply its complete aesthetic: color palette, brush techniques, line work, textures, shading, and lighting approach. The final image must look like a hand-illustrated children's book page, not a filtered photograph—while keeping people precisely recognizable. Replace all photographic elements (realistic textures, camera lighting, photo grain) with illustrated equivalents. Backgrounds should be simplified into clean illustrated shapes and forms. Style emphasis: Create a vignette-style illustration with soft, organic edges that fade into PURE WHITE (#FFFFFF). The vignette edges and any background showing through must be pure white, not off-white, cream, or gray. Match the watercolor/pencil aesthetic, warm color palette, and hand-drawn quality shown in the reference images. Fill the entire canvas with the illustration.`,

    `SCENE INTERPRETATION (Secondary directive): Use the first image as reference for: character/subject identity and their pose, the spatial layout and composition, key recognizable objects that establish the setting. Translate these elements into illustration form - a wooden fence becomes illustrated wood with simple line work, not photographic grain; metal becomes clean illustrated surfaces with simple highlights, not realistic reflections. Simplify complex backgrounds into essential illustrated elements while keeping the scene recognizable.`,

    `PEOPLE - STRICT FIDELITY (non-negotiable):
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

DO NOT reimagine or invent features for any person. A parent must look at your illustration and instantly recognize their child and family.`,
  ];

  // Dynamic effects
  if (ctx.illustrationNotes) {
    sections.push(
      `DYNAMIC EFFECTS: Add visual effects to enhance the action. Draw onomatopoeia text (like "SPLASH!", "ZOOM!", "MUNCH!") in the same BLACK PENCIL-SKETCH STYLE shown in the reference images - using black hand-drawn lettering with sketch-like lines and strokes that match the illustration's aesthetic. Keep effects minimal (under 15% of image area) and directly relevant to the scene - avoid generic sparkles unless the scene involves magic or wonder. Do not alter character faces or poses.`,
      `Specific effect to add: ${ctx.illustrationNotes}`,
    );
  }

  sections.push(
    `COMPOSITION: Fill the entire image canvas with the illustration. No empty space or text areas needed. The illustration should extend to all edges. DO NOT add any text to the image.`,
  );

  return sections.filter(Boolean).join(' ');
}

function vignetteCoverPrompt(ctx: StylePromptContext): string {
  const refCount = ctx.referenceImageCount || 1;

  const sections = [
    `Create a children's picture book illustration ${imageCountText(refCount)}`,

    `ARTISTIC STYLE (Primary directive): Fully transform this into a hand-drawn/painted children's book illustration matching the style from the reference image(s). Apply its complete aesthetic: color palette, brush techniques, line work, textures, shading, and lighting approach. The final image must look like a hand-illustrated children's book page, not a filtered photograph—while keeping people precisely recognizable. Replace all photographic elements (realistic textures, camera lighting, photo grain) with illustrated equivalents. Backgrounds should be simplified into clean illustrated shapes and forms. Style emphasis: Create a vignette-style illustration with soft, organic edges that fade into PURE WHITE (#FFFFFF). The vignette edges and any background showing through must be pure white, not off-white, cream, or gray. Match the watercolor/pencil aesthetic, warm color palette, and hand-drawn quality shown in the reference images. Fill the entire canvas with the illustration.`,

    `SCENE INTERPRETATION (Secondary directive): Use the first image as reference for: character/subject identity and their pose, the spatial layout and composition, key recognizable objects that establish the setting. Translate these elements into illustration form - a wooden fence becomes illustrated wood with simple line work, not photographic grain; metal becomes clean illustrated surfaces with simple highlights, not realistic reflections. Simplify complex backgrounds into essential illustrated elements while keeping the scene recognizable.`,

    `PEOPLE - STRICT FIDELITY (non-negotiable):
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

DO NOT reimagine or invent features for any person. A parent must look at your illustration and instantly recognize their child and family.`,

    `Text: Add the title "${ctx.bookTitle}" in a bold, readable hand-drawn font matching the reference images' text style. Use a Coral (#F76C5E) fill color with a black outline/stroke on the lettering. Position naturally without covering important subjects. Size appropriately (5-7% of image height).`,
  ];

  return sections.filter(Boolean).join(' ');
}

// ----------------------------------
// ORIGAMI STYLE
// ----------------------------------

/**
 * Shared origami base prompt sections (used by both interior and cover).
 * Returns the sections as an array for the caller to extend.
 */
function origamiBaseSections(ctx: StylePromptContext): string[] {
  const refCount = ctx.referenceImageCount || 1;

  return [
    `Create a flat, layered paper-craft illustration ${imageCountText(refCount)} The aesthetic is a handmade paper collage — layered cut paper and simple folded forms — NOT a photograph of a 3D miniature model. Square format, pure white background.`,

    `CONSTRUCTION METHOD:
- All elements are built from flat cut paper shapes layered on top of each other with subtle depth between layers
- Characters and objects use simple geometric paper folds — angular, blocky, chunky construction with visible straight creases and clean-cut edges
- Depth is minimal and comes from paper layering (like a shadow box or layered collage), not from full 3D sculpted origami
- Paper texture is visible throughout — matte, slightly fibrous, with cut edges showing the paper thickness
- No glossy surfaces, no digital smoothness`,

    `PROPORTIONS & CHARACTER STYLE:
- Child characters have a large head (~40% of total height), approximately 1:2.5 head-to-body ratio
- Bodies are blocky and geometric: rectangular torso, angular folded limbs, chunky hands
- Heads are rounded but slightly flattened — more oval panel than sphere
- Faces are ALWAYS: two small black dot eyes, one small curved pencil line for a smile. No other facial features. No eyebrows, no nose detail, no complex expressions.
- Hair is flat layered paper pieces in a single color matching the child's actual hair color`,

    `COLOR PALETTE:
- Warm, slightly muted matte tones — NOT hyper-saturated primaries
- Think craft paper colors: dusty blues, warm browns, tan, olive green, muted red, soft coral, cream, earthy yellow
- Skin tones in warm matte paper (beige, tan, light brown) matching the child's actual skin tone
- No gradients, no metallic, no gloss, no neon or electric colors
- The overall palette should feel cohesive and warm, like paper sourced from the same craft store`,

    `LIGHTING & RENDERING:
- Soft, flat, even lighting — no dramatic shadows or spotlight effects
- No depth of field blur — everything is in focus
- Subtle, natural shadows only where paper layers overlap (thin edge shadows from layering)
- The image should look like a scanned paper collage or a carefully lit flat-lay photograph of paper art`,

    `CLOTHING & APPEARANCE:
- The child's clothing, hair, and appearance must match EXACTLY what is shown in the reference photo, translated into flat, angular paper-craft construction
- Stay faithful to the specific outfit colors and accessories visible in the photo
- Clothing is represented as distinct layered paper shapes (e.g., a vest is a separate paper piece layered over the shirt piece)`,
  ];
}

function origamiInteriorPrompt(ctx: StylePromptContext): string {
  const sections = origamiBaseSections(ctx);

  // Dynamic effects in paper-craft style
  if (ctx.illustrationNotes) {
    sections.push(
      `DYNAMIC EFFECTS: Add visual effects to enhance the action. Draw onomatopoeia text (like "SPLASH!", "ZOOM!", "MUNCH!") as flat cut paper letters in the same craft-paper style — chunky angular shapes cut from colored card stock. Keep effects minimal (under 15% of image area) and directly relevant to the scene. Do not alter character faces or poses.`,
      `Specific effect to add: ${ctx.illustrationNotes}`,
    );
  }

  sections.push(
    `COMPOSITION:
- Focused vignette — the child and key scene elements form a compact, contained paper-craft set piece
- Pure white background surrounding the vignette with no additional elements
- The scene grouping feels natural and balanced, slightly grounded at the bottom
- Key environment details from the reference photo are included but simplified into flat paper-craft forms
- DO NOT add any text to the image.`,

    `Recreate the scene from the reference photo in this paper-craft collage style. The child and their environment should be clearly recognizable from the original photo.`,
  );

  return sections.filter(Boolean).join(' ');
}

function origamiCoverPrompt(ctx: StylePromptContext): string {
  const sections = origamiBaseSections(ctx);

  sections.push(
    `TITLE TEXT:
- Display the title "${ctx.bookTitle}" prominently in the upper portion of the image, above the vignette
- The title is built as flat paper-craft lettering — chunky, angular block letters cut from thick coral-colored card stock (#F76C5E), consistent with the muted craft-paper aesthetic
- Each letter is layered: a slightly larger black paper letter sits directly behind the coral letter, creating a thin, uniform black paper border/outline visible around all edges — two sheets of cut paper stacked, black beneath coral
- This black border is subtle (roughly 2-3mm at scale) but consistent around every letter, giving the title definition and pop against the white background
- Both layers show visible paper texture and clean-cut edges
- The letters are physically part of the collage composition — not digitally overlaid
- Size the title large enough to be easily readable — it is the primary text element on the cover`,

    `COMPOSITION:
- Pure white background surrounding the entire illustration
- The title sits in the upper portion of the image
- The child and key scene elements form a compact, contained paper-craft vignette below the title
- The vignette and title together form a balanced, centered composition on the white page
- The scene grouping feels natural, slightly grounded at the bottom`,

    `Recreate the scene from the reference photo in this paper-craft collage style. The child and their environment should be clearly recognizable from the original photo.`,
  );

  return sections.filter(Boolean).join(' ');
}

// ----------------------------------
// STYLE LIBRARY
// ----------------------------------

export const STYLE_LIBRARY = {
  vignette: {
    label: 'Vignette',
    referenceImageUrls: [
      'https://res.cloudinary.com/storywink/image/upload/v1772284884/Screenshot_2026-02-28_at_9.17.44_PM_twxjzc.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772284892/Screenshot_2026-02-28_at_9.17.35_PM_kexvqz.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772284894/Screenshot_2026-02-28_at_9.17.01_PM_xjwo5u.png',
    ],
    coverReferenceImageUrls: [
      'https://res.cloudinary.com/storywink/image/upload/v1772294382/Screenshot_2026-02-28_at_11.55.28_PM_u0akxv.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772294382/Screenshot_2026-02-28_at_11.55.43_PM_lizco0.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772294383/Screenshot_2026-02-28_at_11.56.00_PM_bfevpr.png',
    ],
    buildInteriorPrompt: vignetteInteriorPrompt,
    buildCoverPrompt: vignetteCoverPrompt,
  },
  origami: {
    label: 'Paper Origami',
    referenceImageUrls: [
      'https://res.cloudinary.com/storywink/image/upload/v1772469317/Gemini_Generated_Image_3jhwbs3jhwbs3jhw_gmjywo.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772469317/Gemini_Generated_Image_sh134wsh134wsh13_ljrnxm.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772469317/Gemini_Generated_Image_eo1k8eo1k8eo1k8e_ce0obt.png',
    ],
    coverReferenceImageUrls: [
      'https://res.cloudinary.com/storywink/image/upload/v1772469248/Gemini_Generated_Image_du037ldu037ldu03_lerc6b.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772469249/Gemini_Generated_Image_hin85shin85shin8_zdynyv.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772469249/Gemini_Generated_Image_nh6rb1nh6rb1nh6r_itqekg.png',
    ],
    buildInteriorPrompt: origamiInteriorPrompt,
    buildCoverPrompt: origamiCoverPrompt,
  },
} satisfies Record<string, StyleDefinition>;

// ----------------------------------
// TYPES
// ----------------------------------

export type StyleKey = keyof typeof STYLE_LIBRARY;

// ----------------------------------
// UTILITY FUNCTIONS
// ----------------------------------

export function isValidStyle(style: string): style is StyleKey {
  return style in STYLE_LIBRARY;
}

export function getStyleDefinition(style: StyleKey): StyleDefinition {
  return STYLE_LIBRARY[style];
}

export function getAllStyleKeys(): StyleKey[] {
  return Object.keys(STYLE_LIBRARY) as StyleKey[];
}

export function getStyleLabel(style: StyleKey): string {
  return STYLE_LIBRARY[style].label;
}

export function getStyleReferenceUrls(style: StyleKey): readonly string[] {
  return STYLE_LIBRARY[style].referenceImageUrls;
}

export function getStylePreviewUrl(style: StyleKey): string {
  return STYLE_LIBRARY[style].referenceImageUrls[0];
}
