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
  language?: string;
  /**
   * Number of character turnaround sheets sent between the content photo and
   * the style exemplars (CHARACTER_SHEETS_ENABLED). 0/absent keeps the
   * legacy image-ordering text byte-identical.
   */
  characterSheetCount?: number;
  /**
   * 1 when the approved interior render of the same scene rides along as a
   * reference (cover calls only), otherwise 0/absent.
   */
  interiorRenderCount?: number;
  /**
   * Role of image 1 (X6d avatar stories — books with no photos anywhere):
   * 'photo' (default, byte-identical legacy wording), 'sheet' (a character
   * turnaround sheet anchors the render), or 'interior' (the approved
   * interior render of the cover scene anchors the cover repaint).
   */
  contentAnchor?: 'photo' | 'sheet' | 'interior';
  /**
   * Ordered name↔sheet map for the sheet-anchored (avatar) branch: one entry
   * per sheet ACTUALLY SENT, in sent order (image 1 first). Renders a per-image
   * binding (`image 1 = Kai, a young boy; …`) so the model stops guessing which
   * unnamed grid is whom. Ignored unless its length matches the sheet count;
   * absent keeps the ordering line byte-identical.
   */
  sheetRoster?: { name: string; species: string }[];
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

function imageCountText(
  refCount: number,
  sheetCount = 0,
  interiorRenderCount = 0,
  contentAnchor: 'photo' | 'sheet' | 'interior' = 'photo',
  sheetRoster?: { name: string; species: string }[],
): string {
  // AVATAR_STORY pages (X6d): image 1 IS a character sheet — fold it into the
  // sheet range so the role line stays truthful (sheetCount counts the
  // ADDITIONAL sheets beyond the anchor).
  if (contentAnchor === 'sheet') {
    const sheetTotal = 1 + sheetCount;
    const total = sheetTotal + interiorRenderCount + refCount;
    const roles: string[] = [
      sheetTotal === 1
        ? `image 1 is a CHARACTER SHEET (2x2 turnaround grid of a character — the canonical reference for face, hair, skin tone, and proportions; it is NOT a scene to copy)`
        : `images 1-${sheetTotal} are CHARACTER SHEETS (2x2 turnaround grids of the characters — the canonical reference for face, hair, skin tone, and proportions; they are NOT scenes to copy)`,
    ];
    // A4 name↔sheet binding: each grid is unnamed, so the model was letting a
    // name's semantics ("Grypho") beat the reference. Bind each image to its
    // character by name. Only when the map matches the sheets sent — a
    // mismatch would misbind, worse than no map.
    if (sheetRoster && sheetRoster.length === sheetTotal) {
      const bindings = sheetRoster
        .map((s, i) => `image ${i + 1} = ${s.name}, ${s.species}`)
        .join('; ');
      roles.push(
        `each sheet is one specific named character — ${bindings} — so draw each character to match their OWN named sheet and never swap identities between sheets`,
      );
    }
    // X12-D style-ref diet: with 0 style images the style-role line must not
    // dangle — the style bible TEXT carries the style truth instead.
    if (refCount > 0) {
      roles.push(
        `the final ${refCount === 1 ? 'image shows' : `${refCount} images show`} the artistic style to apply`,
      );
    }
    // Anti-name-semantics: a griffin was drawn for "Grypho" even WITH the map.
    // The rule rides the sheet branch unconditionally — it matters most when a
    // stale roster drops the map and names only appear in the identity block.
    return `using the ${total} images provided, in this order: ${roles.join('; ')}. A character's NAME is just a label — it never implies appearance or species. Each character's appearance comes ONLY from its numbered character sheet.`;
  }

  // Legacy shape (no character sheets in the request) — byte-identical to the
  // pre-sheet prompt so behavior with CHARACTER_SHEETS_ENABLED off is unchanged.
  if (sheetCount === 0 && interiorRenderCount === 0 && contentAnchor === 'photo') {
    return refCount === 1
      ? `using the two images provided. The first image shows the scene/subjects, the second image shows the artistic style to apply.`
      : `using the ${1 + refCount} images provided. The first image shows the scene/subjects, the following ${refCount} image(s) show the artistic style to apply. Use all style reference images for comprehensive style matching.`;
  }

  // Role-labeled ordering: content photo, character sheet(s), optional
  // approved interior render, style exemplars. ONE line names each image's
  // role by position — the SDKs have no typed reference fields, so this
  // ordering + naming IS the reference mechanism.
  const total = 1 + sheetCount + interiorRenderCount + refCount;
  const roles: string[] = [
    contentAnchor === 'interior'
      ? `image 1 is this book's approved interior illustration of this same scene (repaint the SAME scene and people as the cover)`
      : `image 1 shows the scene/subjects (this page's photo)`,
  ];
  let next = 2;
  if (sheetCount > 0) {
    const range = sheetCount === 1 ? `image ${next}` : `images ${next}-${next + sheetCount - 1}`;
    roles.push(
      `${range} ${sheetCount === 1 ? 'is a CHARACTER SHEET' : 'are CHARACTER SHEETS'} (2x2 turnaround grid${sheetCount === 1 ? '' : 's'} of the main character${sheetCount === 1 ? '' : 's'} — the canonical reference for face, hair, skin tone, and proportions)`,
    );
    next += sheetCount;
  }
  if (interiorRenderCount > 0) {
    roles.push(
      `image ${next} is the book's approved interior illustration of this same scene (match its rendering of the characters and its palette)`,
    );
    next += interiorRenderCount;
  }
  roles.push(
    `the final ${refCount === 1 ? 'image shows' : `${refCount} images show`} the artistic style to apply`,
  );
  return `using the ${total} images provided, in this order: ${roles.join('; ')}.`;
}

// ----------------------------------
// SOURCE HIERARCHY (shared arbitration block)
// ----------------------------------

/**
 * The single arbitration rule between the photo and the canonical character
 * reference. Byte-identical on every page, cover, and (later) character-sheet
 * prompt — the model must never see two prompts that resolve the
 * photo-vs-reference fight differently.
 */
export const PEOPLE_SOURCE_HIERARCHY = `PEOPLE - SOURCE HIERARCHY (non-negotiable):
Every person in the illustration must be immediately recognizable to their own family.
Two sources describe the people in this scene. Apply them in this exact order:
1. IDENTITY — face shape, hair color/style/length, skin tone, and distinguishing features (glasses, freckles, dimples): follow the CHARACTER IDENTITY reference when one is provided below. It is the canonical source; when the photo is ambiguous or disagrees on these features (lighting, angle, shadow, hat), the CHARACTER IDENTITY reference wins.
2. THIS PAGE'S PHOTO — pose, body position, expression, clothing, other people present, and scene composition: follow the photo exactly. Never copy clothing, poses, or people from any style reference image.
If no CHARACTER IDENTITY reference is provided, match every feature to the photo. If a feature is hidden in the photo (hat, angle, shadow) and no reference describes it, keep it hidden — never invent.`;

// ----------------------------------
// VIGNETTE STYLE
// ----------------------------------

/**
 * Frozen style bible — byte-identical in the interior and cover prompts (and
 * later the character-sheet prompt). Never paraphrase this block per builder.
 */
const VIGNETTE_STYLE_BIBLE = `ARTISTIC STYLE (Primary directive): Fully transform this into a hand-drawn/painted children's book illustration matching the style from the reference image(s). Apply its complete aesthetic: color palette, brush techniques, line work, textures, shading, and lighting approach. The final image must look like a hand-illustrated children's book page, not a filtered photograph—while keeping people precisely recognizable. Replace all photographic elements (realistic textures, camera lighting, photo grain) with illustrated equivalents. Backgrounds should be simplified into clean illustrated shapes and forms. Style emphasis: Create a vignette-style illustration with soft, organic edges that fade into PURE WHITE (#FFFFFF). The vignette edges and any background showing through must be pure white, not off-white, cream, or gray. Match the watercolor/pencil aesthetic, warm color palette, and hand-drawn quality shown in the reference images. Fill the entire canvas with the illustration. SCENE INTERPRETATION (Secondary directive): Use the first image as reference for: character/subject identity and their pose, the spatial layout and composition, key recognizable objects that establish the setting. Translate these elements into illustration form - a wooden fence becomes illustrated wood with simple line work, not photographic grain; metal becomes clean illustrated surfaces with simple highlights, not realistic reflections. Simplify complex backgrounds into essential illustrated elements while keeping the scene recognizable. FACIAL RENDERING STYLE (critical for consistency across pages):
Render ALL faces using a simplified children's book style as shown in the reference images:
- Eyes: small, simple dots or short curved lines — NOT detailed realistic eyes
- Nose: tiny dot, small L-shape, or simple curved line — minimal and understated
- Mouth: simple curved line for smiles, small open shape for expressions
- Cheeks: soft rosy circles on cheeks for warmth
- Keep facial details minimal and consistent — simpler faces are more consistent across pages
This simplified face style must be applied uniformly to every person (adults and children alike) while still preserving each person's distinguishing features (hair, skin tone, face shape, glasses, facial hair, etc.) so they remain recognizable. A parent must look at your illustration and instantly recognize their child and family.`;

function vignetteInteriorPrompt(ctx: StylePromptContext): string {
  const refCount = ctx.referenceImageCount ?? 1; // ?? not ||: the X12-D diet passes an explicit 0

  const sections = [
    `Create a children's picture book illustration ${imageCountText(refCount, ctx.characterSheetCount ?? 0, ctx.interiorRenderCount ?? 0, ctx.contentAnchor ?? 'photo', ctx.sheetRoster)}`,

    VIGNETTE_STYLE_BIBLE,

    PEOPLE_SOURCE_HIERARCHY,
  ];

  // Dynamic effects
  if (ctx.illustrationNotes) {
    sections.push(
      `DYNAMIC EFFECTS: Add visual effects to enhance the action. Keep effects minimal (under 15% of image area) and directly relevant to the scene - avoid generic sparkles unless the scene involves magic or wonder. Do not alter character faces or poses.`,
      `Specific effect to add: ${ctx.illustrationNotes} — expressed purely as a visual effect; if the note names a sound or word, depict its energy with motion or particles, never letters.`,
    );
  }

  sections.push(
    `COMPOSITION: Fill the entire image canvas with the illustration. No empty space or text areas needed. The illustration should extend to all edges.`,
  );

  return sections.filter(Boolean).join(' ');
}

function vignetteCoverPrompt(ctx: StylePromptContext): string {
  const refCount = ctx.referenceImageCount ?? 1; // ?? not ||: the X12-D diet passes an explicit 0

  const sections = [
    `Create a children's picture book illustration ${imageCountText(refCount, ctx.characterSheetCount ?? 0, ctx.interiorRenderCount ?? 0, ctx.contentAnchor ?? 'photo', ctx.sheetRoster)}`,

    VIGNETTE_STYLE_BIBLE,

    PEOPLE_SOURCE_HIERARCHY,

    `Each character appears exactly once — never draw the same character twice.`,

    `Title: Render this exact title text and nothing more: "${ctx.bookTitle}". Use a bold, readable hand-drawn font matching the reference images' text style. Position it naturally without covering important subjects, sized appropriately (5-7% of image height). Fill the lettering with #F76C5E and a black outline stroke. The ONLY text in the image is the title above — no subtitles, taglines, color names, or other words.`,
  ];

  return sections.filter(Boolean).join(' ');
}

// ----------------------------------
// ORIGAMI STYLE
// ----------------------------------

/**
 * Frozen style bible — byte-identical in the interior and cover prompts (and
 * later the character-sheet prompt). Never paraphrase this block per builder.
 */
const ORIGAMI_STYLE_BIBLE = [
  `The aesthetic is a handmade paper collage — layered cut paper and simple folded forms — NOT a photograph of a 3D miniature model. Square format, pure white background.`,

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
- The child's clothing must match EXACTLY what is shown in the reference photo, translated into flat, angular paper-craft construction (face, hair, and skin follow the PEOPLE - SOURCE HIERARCHY)
- Stay faithful to the specific outfit colors and accessories visible in the photo
- Clothing is represented as distinct layered paper shapes (e.g., a vest is a separate paper piece layered over the shirt piece)`,
].join(' ');

/**
 * Shared origami base prompt sections (used by both interior and cover).
 * Returns the sections as an array for the caller to extend.
 */
function origamiBaseSections(ctx: StylePromptContext): string[] {
  const refCount = ctx.referenceImageCount ?? 1; // ?? not ||: the X12-D diet passes an explicit 0

  return [
    `Create a flat, layered paper-craft illustration ${imageCountText(refCount, ctx.characterSheetCount ?? 0, ctx.interiorRenderCount ?? 0, ctx.contentAnchor ?? 'photo', ctx.sheetRoster)}`,

    ORIGAMI_STYLE_BIBLE,

    PEOPLE_SOURCE_HIERARCHY,
  ];
}

function origamiInteriorPrompt(ctx: StylePromptContext): string {
  const sections = origamiBaseSections(ctx);

  // Dynamic effects in paper-craft style
  if (ctx.illustrationNotes) {
    sections.push(
      `DYNAMIC EFFECTS: Add visual effects to enhance the action. Keep effects minimal (under 15% of image area) and directly relevant to the scene. Do not alter character faces or poses.`,
      `Specific effect to add: ${ctx.illustrationNotes} — expressed purely as a visual effect; if the note names a sound or word, depict its energy with motion or particles, never letters.`,
    );
  }

  sections.push(
    `COMPOSITION:
- Focused vignette — the child and key scene elements form a compact, contained paper-craft set piece
- Pure white background surrounding the vignette with no additional elements
- The scene grouping feels natural and balanced, slightly grounded at the bottom
- Key environment details from the reference photo are included but simplified into flat paper-craft forms`,

    `Recreate the scene from the reference photo in this paper-craft collage style. The child and their environment should be clearly recognizable from the original photo.`,
  );

  return sections.filter(Boolean).join(' ');
}

function origamiCoverPrompt(ctx: StylePromptContext): string {
  const sections = origamiBaseSections(ctx);

  sections.push(
    `Each character appears exactly once — never draw the same character twice.`,

    `TITLE TEXT:
- Render this exact title text and nothing more: "${ctx.bookTitle}". Display it prominently in the upper portion of the image, above the vignette.
- The title is built as flat paper-craft lettering — chunky, angular block letters cut from thick card stock, consistent with the muted craft-paper aesthetic
- Fill the lettering with #F76C5E and a black outline stroke: each letter is layered, with a slightly larger black paper letter sitting directly behind the #F76C5E letter, creating a thin, uniform black paper border visible around all edges — two sheets of cut paper stacked, black beneath the #F76C5E letter
- This black border is subtle (roughly 2-3mm at scale) but consistent around every letter, giving the title definition and pop against the white background
- Both layers show visible paper texture and clean-cut edges
- The letters are physically part of the collage composition — not digitally overlaid
- Size the title large enough to be easily readable — it is the primary text element on the cover
- The ONLY text in the image is the title above — no subtitles, taglines, color names, or other words.`,

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
// KAWAII STYLE
// ----------------------------------

/**
 * Frozen style bible — byte-identical in the interior and cover prompts (and
 * later the character-sheet prompt). Never paraphrase this block per builder.
 */
const KAWAII_STYLE_BIBLE = [
  `LINE WORK:
- Soft, rounded black outlines with a hand-drawn brush pen quality
- Lines are slightly thicker on outer contours, slightly thinner on interior details
- All corners and edges are rounded — nothing sharp or angular
- Lines are clean but not perfectly mechanical — gentle, organic warmth`,

  `COLORING & TEXTURE:
- Soft, warm pastel-leaning colors with subtle watercolor/crayon grain texture throughout
- Nothing is perfectly smooth or flat — gentle textured quality as if applied with colored pencil or soft watercolor
- Warm and muted palette: sage green, soft pink, warm cream/yellow, light sky blue, tan, dusty rose, warm brown, soft coral, muted orange
- No harsh or neon colors`,

  `CHARACTER PROPORTIONS:
- Children: large round head (~1:2 head-to-body ratio), chunky short limbs, small rounded hands, soft rounded body shapes
- Adults: smaller head relative to body (~1:3.5 ratio), still soft and rounded
- All characters have soft, rounded forms`,

  `FACES (CRITICAL — apply to EVERY character):
- Eyes: small solid black oval dots, slightly vertical, placed low on face with wide spacing. Or happy closed eyes (downward-curved arcs) when showing joy.
- Eyebrows: simple thin curved arcs — subtle but always present
- Nose: tiny dot or absent
- Mouth: small open happy smile or closed gentle curved line
- Blush: ALWAYS soft pink/rosy circular blush marks on both cheeks of EVERY character
- Expression: universally warm, gentle, happy`,

  `HAIR:
- Solid color shape with a few interior lines suggesting strands
- Slightly darker shadow tone at the base
- Soft, rounded silhouette
- Color and style follow the PEOPLE - SOURCE HIERARCHY`,

  `CLOTHING & APPEARANCE:
- Characters' clothing must match the reference photo
- Simplified but recognizable — solid color fills with minimal detail
- Patterns simplified to basic versions`,
].join(' ');

/**
 * Shared kawaii base prompt sections (used by both interior and cover).
 * Returns the sections as an array for the caller to extend.
 */
function kawaiiBaseSections(): string[] {
  return [KAWAII_STYLE_BIBLE, PEOPLE_SOURCE_HIERARCHY];
}

function kawaiiInteriorPrompt(ctx: StylePromptContext): string {
  const refCount = ctx.referenceImageCount ?? 1; // ?? not ||: the X12-D diet passes an explicit 0

  const sections = [
    `Create a warm, gentle children's book illustration in a soft storybook style ${imageCountText(refCount, ctx.characterSheetCount ?? 0, ctx.interiorRenderCount ?? 0, ctx.contentAnchor ?? 'photo', ctx.sheetRoster)} The aesthetic combines clean digital illustration with a subtle watercolor/crayon texture, creating a cozy, nurturing feel. The image should be in landscape format (wider than tall) with softly rounded corners.`,

    ...kawaiiBaseSections(),

    `BACKGROUNDS & ENVIRONMENTS:
- Full scene backgrounds — NOT a vignette on white. The environment fills the entire frame.
- Backgrounds are detailed and cozy, filled with recognizable objects that add warmth and context (toys, plants, furniture, kitchen items, etc.)
- Background elements are fully rendered but slightly softer and less defined than foreground characters
- Soft, diffused warm lighting throughout — no harsh shadows, no dramatic lighting
- The environment should feel lived-in, cozy, and inviting`,
  ];

  // Dynamic effects
  if (ctx.illustrationNotes) {
    sections.push(
      `DYNAMIC EFFECTS: Add visual effects to enhance the action. Keep effects minimal (under 15% of image area) and directly relevant to the scene. Do not alter character faces or poses.`,
      `Specific effect to add: ${ctx.illustrationNotes} — expressed purely as a visual effect; if the note names a sound or word, depict its energy with motion or particles, never letters.`,
    );
  }

  sections.push(
    `COMPOSITION:
- Characters are the clear focal point, sized prominently in the frame
- The scene tells a clear story moment — characters are actively engaged in an activity
- Balanced composition with environmental details framing the characters
- Slight rounded-rectangle framing feel to the overall image`,

    `Recreate the scene from the reference photo in this warm storybook illustration style. The illustration should feel like a page from a high-quality children's picture book — cozy, gentle, and full of warmth.`,
  );

  return sections.filter(Boolean).join(' ');
}

function kawaiiCoverPrompt(ctx: StylePromptContext): string {
  const refCount = ctx.referenceImageCount ?? 1; // ?? not ||: the X12-D diet passes an explicit 0

  const sections = [
    `Create a warm, gentle children's book COVER illustration in a soft storybook style ${imageCountText(refCount, ctx.characterSheetCount ?? 0, ctx.interiorRenderCount ?? 0, ctx.contentAnchor ?? 'photo', ctx.sheetRoster)} The scene is a focused vignette on a pure white background — NOT a full-bleed scene. Square format.`,

    `Match the exact illustration style shown in the style reference images: soft brush-pen outlines, warm pastel watercolor/crayon texture, rosy blush cheeks on all characters, small dot eyes, cozy warmth. The new illustration must look like it belongs in the same book as these reference images.`,

    ...kawaiiBaseSections(),

    `Each character appears exactly once — never draw the same character twice.`,

    `TITLE TEXT:
- Render this exact title text and nothing more: "${ctx.bookTitle}". Display it above the illustration.
- Rounded, bubbly hand-drawn lettering — like a toddler board book cover
- Fill the lettering with #F76C5E and a black outline stroke around each letter for readability against the white background
- Letters can vary slightly in size or angle for a playful, hand-stamped feel
- The title should be modestly sized — readable but not overpowering. The illustration is the hero, the title is a complement.
- The ONLY text in the image is the title above — no subtitles, taglines, color names, or other words.`,

    `COMPOSITION:
- Pure white background for the entire image
- Title sits neatly above the illustration with comfortable spacing
- The illustration is the dominant element, taking up most of the frame
- The vignette is grounded slightly at the bottom with a small soft shadow or ground element (grass, rug, floor) but fades naturally into the white background at the edges — no hard border
- Clean, uncluttered, centered
- The overall layout is balanced and simple`,

    `Recreate the scene from the reference photo as a toddler book cover in this style. The cover should feel like something you'd find in the board book section of a bookstore — adorable vignette, clean white space, instant warmth.`,
  ];

  return sections.filter(Boolean).join(' ');
}

// ----------------------------------
// STYLE LIBRARY
// ----------------------------------

export const STYLE_LIBRARY = {
  vignette: {
    label: 'Pen & Pencil',
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
  kawaii: {
    label: 'Kawaii',
    referenceImageUrls: [
      'https://res.cloudinary.com/storywink/image/upload/v1772552143/Screenshot_2026-03-03_210304_vzwqhj.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772552144/Screenshot_2026-03-03_210150_tqtloy.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772552144/Screenshot_2026-03-03_210329_zzdrzn.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772552149/Screenshot_2026-03-03_210236_ia063u.png',
    ],
    coverReferenceImageUrls: [
      'https://res.cloudinary.com/storywink/image/upload/v1772551692/Gemini_Generated_Image_fbsrpjfbsrpjfbsr_az5jkg.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772551692/Gemini_Generated_Image_9fnhqs9fnhqs9fnh_szlc8j.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772551692/Gemini_Generated_Image_szqw7rszqw7rszqw_oko5z0.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772551692/Gemini_Generated_Image_d4gguyd4gguyd4gg_apxvoz.png',
    ],
    buildInteriorPrompt: kawaiiInteriorPrompt,
    buildCoverPrompt: kawaiiCoverPrompt,
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

// Frozen per-style bible blocks. Interior and cover prompts embed these
// verbatim; the character-sheet prompt (later wave) must reuse them via
// getStyleBible so the sheet can never become a competing style anchor.
const STYLE_BIBLES: Record<StyleKey, string> = {
  vignette: VIGNETTE_STYLE_BIBLE,
  origami: ORIGAMI_STYLE_BIBLE,
  kawaii: KAWAII_STYLE_BIBLE,
};

export function getStyleBible(style: StyleKey): string {
  return STYLE_BIBLES[style];
}
