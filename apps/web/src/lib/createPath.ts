/**
 * Remembered create path (X6d): which way the parent last started a book —
 * 'photos' (upload) or 'avatars' (character stories). Read to soft-highlight
 * the matching card on /create; never used to auto-navigate. localStorage,
 * per the keep-character-declined precedent (try/catch — storage may be
 * unavailable).
 */
export type CreatePath = 'photos' | 'avatars';

const KEY = 'storywink-create-path';

export function rememberCreatePath(path: CreatePath): void {
  try {
    localStorage.setItem(KEY, path);
  } catch {
    /* storage unavailable — remembering is best-effort */
  }
}

export function readCreatePath(): CreatePath | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'photos' || value === 'avatars' ? value : null;
  } catch {
    return null;
  }
}
