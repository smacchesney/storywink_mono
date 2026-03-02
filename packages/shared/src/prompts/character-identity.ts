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

export function createCharacterExtractionPrompt(
  input: CharacterExtractionInput
): { text: string } {
  const characterContext = input.childName
    ? `The main child is named "${input.childName}".`
    : 'Identify the main child in the photos.';

  const additionalContext = input.additionalCharacters?.length
    ? `Other people who may appear: ${input.additionalCharacters.map(c => `${c.name} (${c.relationship})`).join(', ')}.`
    : '';

  return {
    text: `Analyze all ${input.storyPages.length} photos provided. These are photos of the same child/family that will be transformed into children's book illustrations in a "${input.artStyle}" art style.

${characterContext}
${additionalContext}

For EACH distinct person appearing across the photos, extract:

1. **Character ID**: A unique identifier (child_1, adult_1, adult_2, sibling_1, etc.)
2. **Role**: Their role (main_child, parent, sibling, grandparent, friend, etc.)
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

Also describe the overall scene context (indoor/outdoor settings, time of day patterns, general environment).

Be ruthlessly specific. Vague descriptions like "brown hair" are insufficient. Say "medium-length wavy dark brown hair parted slightly to the left, reaching just below the ears, with a small red hair clip on the right side."

The illustrator will use YOUR description as the canonical reference for maintaining identity across every page. Any ambiguity will result in inconsistent characters.`
  };
}

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
                items: { type: 'string' }
              }
            },
            required: ['apparentAge', 'hairColor', 'hairStyle', 'skinTone', 'bodyBuild', 'distinguishingFeatures'],
            additionalProperties: false,
          },
          typicalClothing: { type: 'string' },
          styleTranslation: { type: 'string' },
          appearsOnPages: {
            type: 'array',
            items: { type: 'number' }
          }
        },
        required: ['characterId', 'role', 'name', 'physicalTraits', 'typicalClothing', 'styleTranslation', 'appearsOnPages'],
        additionalProperties: false,
      }
    },
    sceneContext: { type: 'string' }
  },
  required: ['characters', 'sceneContext'],
  additionalProperties: false,
} as const;
