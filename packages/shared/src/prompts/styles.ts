// ----------------------------------
// STYLE LIBRARY
// ----------------------------------

export const STYLE_LIBRARY = {
  vignette: {
    label: 'Vignette',
    referenceImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1750348290/Pencil_Vignette_Style_vF_e89xiy.png',
    description: "Follow the reference image exactly: create a vignette-style illustration with approximately 40% white space around the image borders. The main illustration should be centered within this whitespace frame, maintaining the same compositional balance, text positioning, and spatial relationships as shown in the reference image.",
  },
} as const;

// ----------------------------------
// TYPES
// ----------------------------------

export interface StyleDefinition {
  label: string;
  referenceImageUrl: string;
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