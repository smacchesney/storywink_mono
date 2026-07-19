import { describe, it, expect } from 'vitest';
import {
  STYLE_LIBRARY,
  getAllStyleKeys,
  getStyleBible,
  PEOPLE_SOURCE_HIERARCHY,
} from './styles.js';

const ctx = {
  bookTitle: 'The Puddle Jump',
  pageText: 'Mia jumped right in.',
  illustrationNotes: null,
  referenceImageCount: 2,
  language: 'en',
};

describe('style bible freezing', () => {
  for (const styleKey of getAllStyleKeys()) {
    const style = STYLE_LIBRARY[styleKey];
    const bible = getStyleBible(styleKey);

    it(`${styleKey}: interior and cover embed the byte-identical bible block`, () => {
      expect(bible.length).toBeGreaterThan(100);
      expect(style.buildInteriorPrompt(ctx)).toContain(bible);
      expect(style.buildCoverPrompt(ctx)).toContain(bible);
    });

    it(`${styleKey}: interior and cover embed the shared source hierarchy verbatim`, () => {
      expect(style.buildInteriorPrompt(ctx)).toContain(PEOPLE_SOURCE_HIERARCHY);
      expect(style.buildCoverPrompt(ctx)).toContain(PEOPLE_SOURCE_HIERARCHY);
    });

    it(`${styleKey}: prompts no longer carry the old photo-fidelity block that fought the identity override`, () => {
      expect(style.buildInteriorPrompt(ctx)).not.toContain('PEOPLE - STRICT FIDELITY');
      expect(style.buildCoverPrompt(ctx)).not.toContain('PEOPLE - STRICT FIDELITY');
    });
  }
});

describe('PEOPLE_SOURCE_HIERARCHY arbitration content', () => {
  it('gives identity features to the character reference', () => {
    expect(PEOPLE_SOURCE_HIERARCHY).toContain('CHARACTER IDENTITY reference wins');
  });

  it("gives pose, clothing, and composition to the page's photo", () => {
    expect(PEOPLE_SOURCE_HIERARCHY).toMatch(/pose, body position, expression, clothing/);
    expect(PEOPLE_SOURCE_HIERARCHY).toContain('follow the photo exactly');
  });

  it('keeps the never-invent rule for photo-only books', () => {
    expect(PEOPLE_SOURCE_HIERARCHY).toContain('never invent');
    expect(PEOPLE_SOURCE_HIERARCHY).toContain('match every feature to the photo');
  });
});

describe('cover prompts keep their title treatment', () => {
  for (const styleKey of getAllStyleKeys()) {
    it(`${styleKey}: cover prompt paints the book title`, () => {
      expect(STYLE_LIBRARY[styleKey].buildCoverPrompt(ctx)).toContain('The Puddle Jump');
    });
  }
});

describe('interiors no longer instruct rendered onomatopoeia text', () => {
  const ctxWithNotes = { ...ctx, illustrationNotes: 'splashing through a puddle' };
  for (const styleKey of getAllStyleKeys()) {
    it(`${styleKey}: DYNAMIC EFFECTS drops the lettering instruction but keeps the effects block`, () => {
      const interior = STYLE_LIBRARY[styleKey].buildInteriorPrompt(ctxWithNotes);
      expect(interior).not.toContain('Draw onomatopoeia text');
      expect(interior).not.toContain('onomatopoeia');
      expect(interior).toContain('DYNAMIC EFFECTS: Add visual effects to enhance the action.');
      expect(interior).toContain('under 15% of image area');
      expect(interior).toContain('Specific effect to add: splashing through a puddle');
      // the interior no-text sentence moved to the assembler-level rule
      expect(interior).not.toContain('DO NOT add any text to the image');
    });

    it(`${styleKey}: the effect note is bound to a visual-only rendering`, () => {
      const interior = STYLE_LIBRARY[styleKey].buildInteriorPrompt(ctxWithNotes);
      expect(interior).toContain(
        '— expressed purely as a visual effect; if the note names a sound or word, depict its energy with motion or particles, never letters.',
      );
    });
  }
});

describe('cover prompts forbid duplicate characters', () => {
  for (const styleKey of getAllStyleKeys()) {
    it(`${styleKey}: cover carries the exactly-once cast rule`, () => {
      expect(STYLE_LIBRARY[styleKey].buildCoverPrompt(ctx)).toContain(
        'Each character appears exactly once — never draw the same character twice.',
      );
    });
  }
});

describe('cover title isolation (no leaked color name)', () => {
  for (const styleKey of getAllStyleKeys()) {
    it(`${styleKey}: cover frames the title as a literal, uses hex-only color, no capitalized color name`, () => {
      const cover = STYLE_LIBRARY[styleKey].buildCoverPrompt(ctx);
      expect(cover).not.toContain('Coral');
      expect(cover).toContain('#F76C5E');
      expect(cover).toContain('Render this exact title text and nothing more:');
      expect(cover).toContain('The ONLY text in the image is the title above');
    });
  }
});

// True freeze pins: the containment test above compares the builders against
// the SAME constant, so a bible edit passes it trivially. These literals are
// the actual frozen bytes — editing a bible requires deliberately re-baselining
// the snapshot here.
const FROZEN_BIBLES: Record<string, string> = {
  vignette:
    "ARTISTIC STYLE (Primary directive): Fully transform this into a hand-drawn/painted children's book illustration matching the style from the reference image(s). Apply its complete aesthetic: color palette, brush techniques, line work, textures, shading, and lighting approach. The final image must look like a hand-illustrated children's book page, not a filtered photograph—while keeping people precisely recognizable. Replace all photographic elements (realistic textures, camera lighting, photo grain) with illustrated equivalents. Backgrounds should be simplified into clean illustrated shapes and forms. Style emphasis: Create a vignette-style illustration with soft, organic edges that fade into PURE WHITE (#FFFFFF). The vignette edges and any background showing through must be pure white, not off-white, cream, or gray. Match the watercolor/pencil aesthetic, warm color palette, and hand-drawn quality shown in the reference images. Fill the entire canvas with the illustration. SCENE INTERPRETATION (Secondary directive): Use the first image as reference for: character/subject identity and their pose, the spatial layout and composition, key recognizable objects that establish the setting. Translate these elements into illustration form - a wooden fence becomes illustrated wood with simple line work, not photographic grain; metal becomes clean illustrated surfaces with simple highlights, not realistic reflections. Simplify complex backgrounds into essential illustrated elements while keeping the scene recognizable. FACIAL RENDERING STYLE (critical for consistency across pages):\nRender ALL faces using a simplified children's book style as shown in the reference images:\n- Eyes: small, simple dots or short curved lines — NOT detailed realistic eyes\n- Nose: tiny dot, small L-shape, or simple curved line — minimal and understated\n- Mouth: simple curved line for smiles, small open shape for expressions\n- Cheeks: soft rosy circles on cheeks for warmth\n- Keep facial details minimal and consistent — simpler faces are more consistent across pages\nThis simplified face style must be applied uniformly to every person (adults and children alike) while still preserving each person's distinguishing features (hair, skin tone, face shape, glasses, facial hair, etc.) so they remain recognizable. A parent must look at your illustration and instantly recognize their child and family.",
  origami:
    "The aesthetic is a handmade paper collage — layered cut paper and simple folded forms — NOT a photograph of a 3D miniature model. Square format, pure white background. CONSTRUCTION METHOD:\n- All elements are built from flat cut paper shapes layered on top of each other with subtle depth between layers\n- Characters and objects use simple geometric paper folds — angular, blocky, chunky construction with visible straight creases and clean-cut edges\n- Depth is minimal and comes from paper layering (like a shadow box or layered collage), not from full 3D sculpted origami\n- Paper texture is visible throughout — matte, slightly fibrous, with cut edges showing the paper thickness\n- No glossy surfaces, no digital smoothness PROPORTIONS & CHARACTER STYLE:\n- Child characters have a large head (~40% of total height), approximately 1:2.5 head-to-body ratio\n- Bodies are blocky and geometric: rectangular torso, angular folded limbs, chunky hands\n- Heads are rounded but slightly flattened — more oval panel than sphere\n- Faces are ALWAYS: two small black dot eyes, one small curved pencil line for a smile. No other facial features. No eyebrows, no nose detail, no complex expressions.\n- Hair is flat layered paper pieces in a single color matching the child's actual hair color COLOR PALETTE:\n- Warm, slightly muted matte tones — NOT hyper-saturated primaries\n- Think craft paper colors: dusty blues, warm browns, tan, olive green, muted red, soft coral, cream, earthy yellow\n- Skin tones in warm matte paper (beige, tan, light brown) matching the child's actual skin tone\n- No gradients, no metallic, no gloss, no neon or electric colors\n- The overall palette should feel cohesive and warm, like paper sourced from the same craft store LIGHTING & RENDERING:\n- Soft, flat, even lighting — no dramatic shadows or spotlight effects\n- No depth of field blur — everything is in focus\n- Subtle, natural shadows only where paper layers overlap (thin edge shadows from layering)\n- The image should look like a scanned paper collage or a carefully lit flat-lay photograph of paper art CLOTHING & APPEARANCE:\n- The child's clothing must match EXACTLY what is shown in the reference photo, translated into flat, angular paper-craft construction (face, hair, and skin follow the PEOPLE - SOURCE HIERARCHY)\n- Stay faithful to the specific outfit colors and accessories visible in the photo\n- Clothing is represented as distinct layered paper shapes (e.g., a vest is a separate paper piece layered over the shirt piece)",
  kawaii:
    "LINE WORK:\n- Soft, rounded black outlines with a hand-drawn brush pen quality\n- Lines are slightly thicker on outer contours, slightly thinner on interior details\n- All corners and edges are rounded — nothing sharp or angular\n- Lines are clean but not perfectly mechanical — gentle, organic warmth COLORING & TEXTURE:\n- Soft, warm pastel-leaning colors with subtle watercolor/crayon grain texture throughout\n- Nothing is perfectly smooth or flat — gentle textured quality as if applied with colored pencil or soft watercolor\n- Warm and muted palette: sage green, soft pink, warm cream/yellow, light sky blue, tan, dusty rose, warm brown, soft coral, muted orange\n- No harsh or neon colors CHARACTER PROPORTIONS:\n- Children: large round head (~1:2 head-to-body ratio), chunky short limbs, small rounded hands, soft rounded body shapes\n- Adults: smaller head relative to body (~1:3.5 ratio), still soft and rounded\n- All characters have soft, rounded forms FACES (CRITICAL — apply to EVERY character):\n- Eyes: small solid black oval dots, slightly vertical, placed low on face with wide spacing. Or happy closed eyes (downward-curved arcs) when showing joy.\n- Eyebrows: simple thin curved arcs — subtle but always present\n- Nose: tiny dot or absent\n- Mouth: small open happy smile or closed gentle curved line\n- Blush: ALWAYS soft pink/rosy circular blush marks on both cheeks of EVERY character\n- Expression: universally warm, gentle, happy HAIR:\n- Solid color shape with a few interior lines suggesting strands\n- Slightly darker shadow tone at the base\n- Soft, rounded silhouette\n- Color and style follow the PEOPLE - SOURCE HIERARCHY CLOTHING & APPEARANCE:\n- Characters' clothing must match the reference photo\n- Simplified but recognizable — solid color fills with minimal detail\n- Patterns simplified to basic versions",
};

describe('style bibles are frozen byte-for-byte', () => {
  for (const styleKey of getAllStyleKeys()) {
    it(`${styleKey}: bible matches the inline frozen snapshot`, () => {
      expect(getStyleBible(styleKey)).toBe(FROZEN_BIBLES[styleKey]);
    });
  }
});

// A4 name↔sheet binding on the PHOTO path (X16 W1): photo-path pages that ship
// character sheets now bind each sheet to its named character, exactly like the
// avatar (sheet-anchored) branch. image 1 is the photo, so the sheets map to
// images 2..N+1. Without a roster (or on a count mismatch) the wording must
// stay byte-identical to the generic pre-binding line.
describe('photo-path name↔sheet binding (X16 W1)', () => {
  const photoSheetCtx = {
    bookTitle: 'T',
    pageText: 'p',
    illustrationNotes: null,
    referenceImageCount: 0,
    language: 'en',
    characterSheetCount: 2,
    interiorRenderCount: 0,
    contentAnchor: 'photo' as const,
  };

  // The exact generic ordering line the photo branch emits with NO roster —
  // the byte-for-byte regression pin. A roster only APPENDS a binding clause
  // before the style line; this generic line must survive verbatim and stand
  // alone whenever no (matching) roster is supplied.
  const GENERIC_PHOTO_SHEET_LINE =
    "using the 3 images provided, in this order: image 1 shows the scene/subjects (this page's photo); images 2-3 are CHARACTER SHEETS (2x2 turnaround grids of the main characters — the canonical reference for face, hair, skin tone, and proportions); the final 0 images show the artistic style to apply.";

  it('binds sheets to names when a roster is provided', () => {
    const prompt = STYLE_LIBRARY.vignette.buildInteriorPrompt({
      ...photoSheetCtx,
      sheetRoster: [
        { name: 'Emma', species: 'a young girl' },
        { name: 'Grandma', species: 'a grown woman' },
      ],
    });
    expect(prompt).toContain('image 2 = Emma, a young girl');
    expect(prompt).toContain('image 3 = Grandma, a grown woman');
    expect(prompt).toContain('never swap identities between sheets');
    // The generic sheet role line is still present verbatim; the binding is an
    // ADDED clause, so image 1 stays the photo and the sheets are images 2-3.
    expect(prompt).toContain(
      'images 2-3 are CHARACTER SHEETS (2x2 turnaround grids of the main characters',
    );
  });

  it('leaves the photo branch byte-identical when NO roster is supplied', () => {
    const prompt = STYLE_LIBRARY.vignette.buildInteriorPrompt(photoSheetCtx);
    expect(prompt).toContain(GENERIC_PHOTO_SHEET_LINE);
    expect(prompt).not.toContain('image 2 =');
    expect(prompt).not.toContain('never swap identities between sheets');
  });

  it('omits the binding (stays byte-identical) when the roster count mismatches', () => {
    const prompt = STYLE_LIBRARY.vignette.buildInteriorPrompt({
      ...photoSheetCtx,
      sheetRoster: [{ name: 'Emma', species: 'a young girl' }], // 1 ≠ 2 sheets
    });
    expect(prompt).toContain(GENERIC_PHOTO_SHEET_LINE);
    expect(prompt).not.toContain('image 2 =');
    expect(prompt).not.toContain('never swap identities between sheets');
  });
});
