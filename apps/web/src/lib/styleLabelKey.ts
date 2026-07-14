import type { StyleKey } from '@storywink/shared/prompts/styles';

/**
 * The single source of truth mapping a style key to its `setup`-namespace i18n
 * label key. Call it as `t(styleLabelKey(style))` with a `setup`-scoped
 * translator. Extracted from ArtStyleStrip, the wizard, and the wardrobe sheet
 * so a fourth (or fifth) style adds exactly one entry, in one place.
 */
const STYLE_LABEL_KEYS: Record<StyleKey, string> = {
  vignette: 'styleVignette',
  origami: 'styleOrigami',
  kawaii: 'styleKawaii',
};

export function styleLabelKey(style: StyleKey): string {
  return STYLE_LABEL_KEYS[style];
}
