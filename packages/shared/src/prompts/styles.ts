// ----------------------------------
// STYLE LIBRARY
// ----------------------------------

export const STYLE_LIBRARY = {
  vignette: {
    label: 'Vignette',
    // Text-free references for story pages (text added programmatically)
    // Two references for better style consistency with onomatopoeia examples
    referenceImageUrls: [
      'https://res.cloudinary.com/storywink/image/upload/v1764939472/Pencil_Vignette_ref_1_evxxjl.jpg',
      'https://res.cloudinary.com/storywink/image/upload/v1764939472/Pencil_Vignette_ref_2_tvaogo.jpg',
    ],
    // Reference with text for title pages (AI generates artistic title text)
    coverReferenceImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1764941361/Pencil_Vignette_title_ref_1_gbuznf.png',
    description: "Create a vignette-style illustration filling the top ~82% of the image. The illustration should have soft, fading edges at the bottom that blend into PURE WHITE (#FFFFFF) space. Leave the bottom ~18% as empty pure white space for text overlay. All border areas must be pure white, not off-white or cream. Match the watercolor/pencil aesthetic, warm color palette, and hand-drawn quality shown in the reference images.",
  },
} as const;

// ----------------------------------
// TYPES
// ----------------------------------

export interface StyleDefinition {
  label: string;
  referenceImageUrls: readonly string[];
  coverReferenceImageUrl?: string;
  description?: string | null;
}

export type StyleKey = keyof typeof STYLE_LIBRARY;

// Type-safe style library
export const TypedStyleLibrary: Record<StyleKey, StyleDefinition> = STYLE_LIBRARY;

// ----------------------------------
// UTILITY FUNCTIONS
// ----------------------------------

export function isValidStyle(style: string): style is StyleKey {
  return style in STYLE_LIBRARY;
}

export function getStyleDefinition(style: StyleKey): StyleDefinition {
  return TypedStyleLibrary[style];
}

export function getAllStyleKeys(): StyleKey[] {
  return Object.keys(STYLE_LIBRARY) as StyleKey[];
}

export function getStyleLabel(style: StyleKey): string {
  return TypedStyleLibrary[style].label;
}

export function getStyleReferenceUrls(style: StyleKey): readonly string[] {
  return TypedStyleLibrary[style].referenceImageUrls;
}

export function getStylePreviewUrl(style: StyleKey): string {
  return TypedStyleLibrary[style].referenceImageUrls[0];
}