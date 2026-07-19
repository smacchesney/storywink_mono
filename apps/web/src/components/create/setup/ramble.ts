/**
 * X17 B4 — ramble field rules. 1500 chars matches the avatar spark's
 * PREMISE_MAX_CHARS; below RAMBLE_EXTRACT_MIN_CHARS an extraction call
 * would be noise (and cost) for a one-line summary tweak.
 */
export const RAMBLE_MAX_CHARS = 1500;
export const RAMBLE_EXTRACT_MIN_CHARS = 40;

export function clampRamble(text: string): string {
  return text.slice(0, RAMBLE_MAX_CHARS);
}

export function shouldExtract(text: string, lastExtracted: string | null): boolean {
  const trimmed = text.trim();
  return trimmed.length >= RAMBLE_EXTRACT_MIN_CHARS && trimmed !== lastExtracted;
}
