// ----------------------------------
// STYLE LIBRARY
// ----------------------------------

export const STYLE_LIBRARY = {
  vignette: {
    label: 'Vignette',
    // Text-free reference for story pages (text added programmatically)
    referenceImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1733358909/WhatsApp_Image_2025-12-04_at_23.35.09_hxjdcu.jpg',
    // Reference with text for title pages (AI generates artistic title text)
    coverReferenceImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1764772654/Pencil_Vignette_Style_FRONTCOVER_vF_jz9kez.png',
    description: "Create a vignette-style illustration filling the top ~82% of the image. The illustration should have soft, fading edges at the bottom that blend into PURE WHITE (#FFFFFF) space. Leave the bottom ~18% as empty pure white space for text overlay. All border areas must be pure white, not off-white or cream. Match the watercolor/pencil aesthetic, warm color palette, and hand-drawn quality shown in the reference image.",
  },
} as const;

// ----------------------------------
// TYPES
// ----------------------------------

export interface StyleDefinition {
  label: string;
  referenceImageUrl: string;
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

export function getStyleReferenceUrl(style: StyleKey): string {
  return TypedStyleLibrary[style].referenceImageUrl;
}