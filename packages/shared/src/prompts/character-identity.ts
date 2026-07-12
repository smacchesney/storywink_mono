/**
 * Character Identity Extraction Prompt
 *
 * Analyzes all uploaded photos together via vision model to produce a canonical
 * character description. This is generated once per book and injected into every
 * illustration prompt for cross-page consistency.
 */

export const CHARACTER_IDENTITY_SYSTEM_PROMPT =
  "You are an expert visual analyst specializing in children's book illustration. Your task is to analyze photographs and extract precise, consistent character descriptions that will guide an AI illustrator to maintain character identity across multiple book pages.";

export interface CharacterExtractionInput {
  childName: string | null;
  additionalCharacters: { name: string; relationship: string }[] | null;
  artStyle: string;
  storyPages: {
    pageNumber: number;
    imageUrl: string;
  }[];
}

export function createCharacterExtractionPrompt(input: CharacterExtractionInput): { text: string } {
  const characterContext = input.childName
    ? `The main child is named "${input.childName}".`
    : 'Identify the main child in the photos.';

  const additionalContext = input.additionalCharacters?.length
    ? `Other people who may appear: ${input.additionalCharacters.map((c) => `${c.name} (${c.relationship})`).join(', ')}.`
    : '';

  return {
    text: `Analyze all ${input.storyPages.length} photos provided. These are photos of the same child/family that will be transformed into children's book illustrations in a "${input.artStyle}" art style.

${characterContext}
${additionalContext}

For EACH distinct person appearing across the photos, AND each animal companion (pet) that appears in 2+ photos or is clearly central to a moment, extract:

1. **Character ID**: A unique identifier (child_1, adult_1, adult_2, sibling_1, pet_1, etc.)
2. **Role**: Their role (main_child, parent, sibling, grandparent, friend, pet, etc.)
3. **Name**: If identifiable from context provided above, otherwise null
4. **Physical Traits** (be extremely precise — these must match across all illustrations):
   - Apparent age range
   - Hair color (exact shade, e.g. "jet black" not just "dark")
   - Hair style (length, texture, parting, accessories like clips/bands)
   - Skin tone (specific warm/cool description, e.g. "warm golden-brown" not just "tan")
   - Body build relative to age
   - Distinguishing features (glasses, freckles, dimples, birthmarks, ear shape, etc.)
5. **Typical Clothing**: What they wear across the photos (note if it varies per photo)
6. **Style Translation**: How this person should be rendered in "${input.artStyle}" style while remaining instantly recognizable. Be specific about materials, construction, colors, and proportions for the target style.
7. **Pages**: Which page numbers (from the photo sequence 1-${input.storyPages.length}) this person appears in

For pets, reuse the same fields naturally: hair color/style = fur or coat color and texture, distinguishing features = collar, markings, ear shape, size; typical clothing = collar/harness or "none".

Also describe the overall scene context (indoor/outdoor settings, time of day patterns, general environment).

Be ruthlessly specific. Vague descriptions like "brown hair" are insufficient. Say "medium-length wavy dark brown hair parted slightly to the left, reaching just below the ears, with a small red hair clip on the right side."

The illustrator will use YOUR description as the canonical reference for maintaining identity across every page. Any ambiguity will result in inconsistent characters.`,
  };
}

// ----------------------------------
// STYLE TRANSLATION REFRESH (text-only)
// ----------------------------------

/**
 * Rewrites ONLY the styleTranslation strings of an existing identity for a
 * new art style. Used when a remapped identity carries prose written for a
 * different style (extractedForStyle mismatch) — a cheap text-only call, so
 * the default path never re-pays the full vision extraction.
 */

export const STYLE_TRANSLATION_REFRESH_SYSTEM_PROMPT =
  "You are an expert art director for children's picture books. You rewrite character rendering instructions for a new art style without changing who the character is.";

export interface StyleTranslationRefreshCharacter {
  characterId: string;
  role: string;
  name: string | null;
  physicalTraits: {
    apparentAge: string;
    hairColor: string;
    hairStyle: string;
    skinTone: string;
    bodyBuild: string;
    distinguishingFeatures: string[];
  };
  typicalClothing: string;
}

export function createStyleTranslationRefreshPrompt(
  characters: StyleTranslationRefreshCharacter[],
  artStyle: string,
): string {
  const characterBlocks = characters
    .map((c) => {
      const t = c.physicalTraits;
      return [
        `- characterId: ${c.characterId} (${c.role}${c.name ? `, name: ${c.name}` : ''})`,
        `  Age: ${t.apparentAge}`,
        `  Hair: ${t.hairColor}, ${t.hairStyle}`,
        `  Skin tone: ${t.skinTone}`,
        `  Build: ${t.bodyBuild}`,
        t.distinguishingFeatures.length > 0
          ? `  Distinguishing features: ${t.distinguishingFeatures.join(', ')}`
          : null,
        `  Typical clothing: ${c.typicalClothing}`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return `The characters below were described for a different art style. Their physical traits are canonical and must NOT change.

For EACH character, write a new "styleTranslation": how this person should be rendered in the "${artStyle}" art style while remaining instantly recognizable. Be specific about materials, construction, colors, and proportions for the target style — the same precision you would give an illustrator who has never seen these people.

${characterBlocks}

Return exactly one entry per characterId listed above, echoing the characterId unchanged.`;
}

export const STYLE_TRANSLATION_REFRESH_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          characterId: { type: 'string' },
          styleTranslation: { type: 'string' },
        },
        required: ['characterId', 'styleTranslation'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
} as const;

// ----------------------------------
// CHARACTER SHEET (2x2 turnaround) GENERATION + VALIDATION
// ----------------------------------

/**
 * Character subset needed to describe one person on a sheet prompt.
 * Structurally compatible with CharacterDescription in types.ts.
 */
export interface SheetCharacterInput {
  characterId: string;
  role: string;
  name: string | null;
  physicalTraits: {
    apparentAge: string;
    hairColor: string;
    hairStyle: string;
    skinTone: string;
    bodyBuild: string;
    distinguishingFeatures: string[];
  };
  styleTranslation: string;
}

function sheetCharacterBlock(character: SheetCharacterInput): string {
  const t = character.physicalTraits;
  return [
    `CHARACTER (canonical identity — every panel must match this exactly):`,
    `- ${character.name || character.characterId} (${character.role})`,
    `- Age: ${t.apparentAge}`,
    `- Hair: ${t.hairColor}, ${t.hairStyle}`,
    `- Skin tone: ${t.skinTone}`,
    `- Build: ${t.bodyBuild}`,
    t.distinguishingFeatures.length > 0
      ? `- Distinguishing features: ${t.distinguishingFeatures.join(', ')}`
      : null,
    character.styleTranslation ? `- Style rendering: ${character.styleTranslation}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Prompt for generating one 2x2 turnaround character sheet.
 *
 * Image order the caller must send: the character's source photos first
 * (ground-truth identity), then the SAME 2 style exemplar images the book's
 * pages use. The style bible block must be the frozen constant from
 * getStyleBible() — a paraphrased or prose-only sheet drifts off-style and
 * then wins the arbitration fight against the page exemplars.
 */
export function createCharacterSheetPrompt(input: {
  character: SheetCharacterInput;
  photoCount: number;
  styleRefCount: number;
  styleBible: string;
}): string {
  const { character, photoCount, styleRefCount, styleBible } = input;
  return [
    `Create ONE image: a 2x2 character model sheet (turnaround grid) of the SAME child, ` +
      `using the ${photoCount + styleRefCount} images provided, in this order: ` +
      `the first ${photoCount === 1 ? 'image is a photo' : `${photoCount} images are photos`} of the character (ground truth for identity); ` +
      `the final ${styleRefCount === 1 ? 'image shows' : `${styleRefCount} images show`} the artistic style to apply.`,
    `THE GRID (exactly 4 panels, equal size, on a single plain PURE WHITE background):`,
    `- Top-left: front view, standing, neutral-happy expression`,
    `- Top-right: three-quarter view`,
    `- Bottom-left: side profile view`,
    `- Bottom-right: back view`,
    `Every panel depicts the SAME character at the same scale with identical face, hair, skin tone, proportions, and outfit. Full body visible in each panel.`,
    sheetCharacterBlock(character),
    styleBible,
    `STRICT RULES: no text, no labels, no captions, no watermarks, no panel borders, no props, no background scenery — just the character four times on pure white. Do NOT copy any person, clothing, or pose from the style reference images; they define ONLY the artistic style.`,
  ].join(' ');
}

export const SHEET_VALIDATION_SYSTEM_PROMPT =
  "You are a meticulous art director for children's picture books. You verify that a generated character model sheet faithfully represents a real child from their photos and matches the book's art style.";

/**
 * Prompt for validating a generated sheet with a vision model.
 *
 * Image order the caller must send: source photos, then the candidate sheet,
 * then the 2 style exemplars.
 */
export function createSheetValidationPrompt(input: {
  character: SheetCharacterInput;
  photoCount: number;
  styleRefCount: number;
  artStyle: string;
}): string {
  const { character, photoCount, styleRefCount, artStyle } = input;
  return [
    `You are shown ${photoCount + 1 + styleRefCount} images, in this order: ` +
      `${photoCount === 1 ? '1 photo' : `${photoCount} photos`} of a real child (ground truth), ` +
      `then 1 candidate 2x2 character model sheet, ` +
      `then ${styleRefCount} art style exemplar image(s) for the "${artStyle}" style.`,
    sheetCharacterBlock(character),
    `Evaluate the candidate sheet:`,
    `1. sameCharacter: Is the character on the sheet recognizably the SAME child as in the photos (hair color/style, skin tone, distinguishing features)? Judge against the photos and the description above.`,
    `2. allPanelsConsistent: Do all four panels depict the same character with identical features, proportions, and outfit?`,
    `3. styleMatches: Does the sheet's rendering match the art style exemplars (line work, palette, construction method)?`,
    `4. noTextArtifacts: Is the sheet free of any text, labels, captions, watermarks, and obvious anatomical errors (wrong finger count, fused features)?`,
    `Set passed=true only if ALL four checks pass. Describe any failure precisely in notes.`,
  ].join('\n\n');
}

export const SHEET_VALIDATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    sameCharacter: { type: 'boolean' },
    allPanelsConsistent: { type: 'boolean' },
    styleMatches: { type: 'boolean' },
    noTextArtifacts: { type: 'boolean' },
    passed: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: [
    'sameCharacter',
    'allPanelsConsistent',
    'styleMatches',
    'noTextArtifacts',
    'passed',
    'notes',
  ],
  additionalProperties: false,
} as const;

// Response schema for structured output (OpenAI strict mode)
export const CHARACTER_IDENTITY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          characterId: { type: 'string' },
          role: { type: 'string' },
          name: { type: ['string', 'null'] },
          physicalTraits: {
            type: 'object',
            properties: {
              apparentAge: { type: 'string' },
              hairColor: { type: 'string' },
              hairStyle: { type: 'string' },
              skinTone: { type: 'string' },
              bodyBuild: { type: 'string' },
              distinguishingFeatures: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: [
              'apparentAge',
              'hairColor',
              'hairStyle',
              'skinTone',
              'bodyBuild',
              'distinguishingFeatures',
            ],
            additionalProperties: false,
          },
          typicalClothing: { type: 'string' },
          styleTranslation: { type: 'string' },
          appearsOnPages: {
            type: 'array',
            items: { type: 'number' },
          },
        },
        required: [
          'characterId',
          'role',
          'name',
          'physicalTraits',
          'typicalClothing',
          'styleTranslation',
          'appearsOnPages',
        ],
        additionalProperties: false,
      },
    },
    sceneContext: { type: 'string' },
  },
  required: ['characters', 'sceneContext'],
  additionalProperties: false,
} as const;

/** Input for single-subject (account avatar) identity extraction. */
export interface AvatarIdentityPromptInput {
  /** AvatarKind string: CHILD | ADULT | PET | TOY. */
  kind: string;
  displayName: string;
  artStyle: string;
  photoCount: number;
}

/**
 * Single-subject variant of the extraction prompt for account avatars: every
 * photo shows the SAME subject (a child, a grown-up, a pet, or a beloved
 * toy/object). Reuses CHARACTER_IDENTITY_RESPONSE_SCHEMA — the model returns
 * a one-entry characters array.
 */
export function createAvatarIdentityPrompt(input: AvatarIdentityPromptInput): { text: string } {
  const subjectByKind: Record<string, { noun: string; role: string; traits: string }> = {
    CHILD: {
      noun: 'child',
      role: 'main_child',
      traits:
        'hair color as an exact shade; hair style with length/texture/parting/accessories; skin tone with warm/cool specificity; body build relative to age; distinguishing features (glasses, freckles, dimples, birthmarks)',
    },
    ADULT: {
      noun: 'grown-up',
      role: 'adult',
      traits:
        'hair color as an exact shade; hair style; skin tone with warm/cool specificity; build; distinguishing features (glasses, beard, jewelry they always wear)',
    },
    PET: {
      noun: 'pet',
      role: 'pet',
      traits:
        'fur/coat color and texture (as hair color/style), collar/markings/ear shape/size relative to a child (as distinguishing features), "none" for clothing unless they wear a collar or harness',
    },
    TOY: {
      noun: 'beloved toy or object',
      role: 'companion_object',
      traits:
        'material and color (as hair color), texture and visible wear — "well-loved, slightly flattened fur" (as hair style), ears/patches/tags/size relative to a child (as distinguishing features), "none" for clothing',
    },
  };
  const subject = subjectByKind[input.kind] ?? subjectByKind.ADULT;

  return {
    text: `Analyze all ${input.photoCount} photos provided. Every photo shows the SAME ${subject.noun}, called "${input.displayName}", who will become a recurring illustrated character in a "${input.artStyle}" art style children's book.

Extract EXACTLY ONE character entry:

1. **Character ID**: "avatar_subject"
2. **Role**: "${subject.role}"
3. **Name**: "${input.displayName}"
4. **Physical Traits** (be extremely precise — these must match across every future illustration): apparent age (or apparent age of the object, e.g. "well-loved"); ${subject.traits}
5. **Typical Clothing**: the most characteristic, NEUTRAL everyday outfit across the photos — this becomes the canonical reference outfit (stories will dress them differently per scene)
6. **Style Translation**: how to render this ${subject.noun} in "${input.artStyle}" style while staying instantly recognizable — materials, construction, colors, proportions
7. **Pages**: which photo numbers (1-${input.photoCount}) show the subject (usually all)

Be ruthlessly specific. Vague descriptions like "brown hair" are insufficient. The illustrator will use YOUR description as the canonical reference for this character in every book the family ever makes.

Also give sceneContext: one short sentence about the settings visible in the photos.`,
  };
}
