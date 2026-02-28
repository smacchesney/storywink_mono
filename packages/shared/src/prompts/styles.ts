// ----------------------------------
// STYLE LIBRARY
// ----------------------------------

export const STYLE_LIBRARY = {
  vignette: {
    label: 'Vignette',
    // Three references for style + facial consistency across pages
    referenceImageUrls: [
      'https://res.cloudinary.com/storywink/image/upload/v1772284884/Screenshot_2026-02-28_at_9.17.44_PM_twxjzc.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772284892/Screenshot_2026-02-28_at_9.17.35_PM_kexvqz.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772284894/Screenshot_2026-02-28_at_9.17.01_PM_xjwo5u.png',
    ],
    // Reference images for title pages (AI generates artistic title text)
    coverReferenceImageUrls: [
      'https://res.cloudinary.com/storywink/image/upload/v1772294382/Screenshot_2026-02-28_at_11.55.28_PM_u0akxv.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772294382/Screenshot_2026-02-28_at_11.55.43_PM_lizco0.png',
      'https://res.cloudinary.com/storywink/image/upload/v1772294383/Screenshot_2026-02-28_at_11.56.00_PM_bfevpr.png',
    ],
    description: "Create a vignette-style illustration with soft, organic edges that fade into PURE WHITE (#FFFFFF). The vignette edges and any background showing through must be pure white, not off-white, cream, or gray. Match the watercolor/pencil aesthetic, warm color palette, and hand-drawn quality shown in the reference images. Fill the entire canvas with the illustration.",
  },
} as const;

// ----------------------------------
// TYPES
// ----------------------------------

export interface StyleDefinition {
  label: string;
  referenceImageUrls: readonly string[];
  coverReferenceImageUrls?: readonly string[];
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