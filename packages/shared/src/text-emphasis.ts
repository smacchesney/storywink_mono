/**
 * Learning-word emphasis: split page text into plain/emphasized segments so
 * every renderer (flipbook React nodes, PDF HTML, anywhere else) draws the
 * SAME single treatment — bold + coral, same typeface, same size.
 *
 * Boundaries come from the generation step (`Page.learningWordsUsed` lists
 * the exact parent-supplied words this page carries), never from a post-hoc
 * segmenter: English matches on word boundaries, CJK on exact substrings.
 * Browser-safe, dependency-free.
 */

export interface EmphasisSegment {
  text: string;
  emphasized: boolean;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasLatin = (value: string) => /[A-Za-zÀ-ɏ]/.test(value);

/**
 * Split `text` into segments, emphasizing every occurrence of each word.
 * Longer words match first so "raincoat" wins over "rain" when both are
 * supplied. Case-insensitive for Latin words; exact for CJK. Returns a
 * single plain segment when nothing matches (or no words are given).
 */
export function splitEmphasisSegments(
  text: string,
  words: string[],
): EmphasisSegment[] {
  const cleaned = [...new Set(words.map(w => w.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!text || cleaned.length === 0) return [{ text, emphasized: false }];

  const alternatives = cleaned
    .map(word => {
      const escaped = escapeRegExp(word);
      // Latin words match on boundaries ("cat" never lights up "catalog");
      // CJK has no spaces, so the exact parent-supplied string is the token.
      return hasLatin(word) ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped;
    })
    .join('|');
  const matcher = new RegExp(alternatives, 'giu');

  const segments: EmphasisSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(matcher)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), emphasized: false });
    segments.push({ text: match[0], emphasized: true });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), emphasized: false });
  return segments.length > 0 ? segments : [{ text, emphasized: false }];
}
