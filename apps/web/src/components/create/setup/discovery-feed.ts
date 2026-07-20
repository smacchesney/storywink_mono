/**
 * X17 B1/B3 — pure selection logic for the discovery feed and the star ask.
 * Everything derives from persisted perception output (Page.analysis +
 * Book.characterIdentity); no fetches, no React. Mirrors the strip-phase
 * pattern: components render, this module decides.
 */

export interface RosterCharacterLike {
  characterId: string;
  role: string;
  name?: string | null;
  /** X17.2: perception-authored short label ("the little boy in the striped
   * shirt"). Preferred over the distiller for unnamed characters. */
  descriptor?: string | null;
  species?: string | null;
  isForeground?: boolean;
  appearsOnPages?: number[];
  physicalTraits?: {
    apparentAge?: string;
    hairColor?: string;
    hairStyle?: string;
    distinguishingFeatures?: string[];
  };
  /** X17.2: face rectangle in ONE photo (structural mirror of the shared
   * FaceBox — no shared import; this is the client's roster shape). */
  faceBox?: {
    pageNumber: number;
    x: number;
    y: number;
    w: number;
    h: number;
    assetId?: string | null;
  } | null;
}

export interface AnalyzedPageLike {
  assetId: string | null;
  analysis?: unknown;
}

export interface DiscoveryChip {
  id: string;
  kind: 'setting' | 'cast' | 'signal';
  label: string;
}

export const MAX_DISCOVERY_CHIPS = 5;

/** Roles that count as "a kid in the photos" for the star ask. */
export const CHILD_ROLES = ['main_child', 'sibling', 'friend'] as const;

/** B3 threshold: a child seen in 2+ photos is a recurring kid. */
export const RECURRING_MIN_PAGES = 2;

// Warm, short, article-prefixed English nouns — deliberately English like the
// perception traits above (the describeCharacter comment notes traits arrive in
// English regardless of book language; `memberNameQuestion` interpolates this
// label into both en and ja copy, so all entries stay in one language). New
// payloads carry `descriptor`, which wins over these; ROLE_NOUNS only fires for
// legacy rows with no descriptor. Keys track the PERCEPTION_ROLES enum.
const ROLE_NOUNS: Record<string, string> = {
  main_child: 'a little one',
  sibling: 'a little one',
  friend: 'a little friend',
  parent: 'a grown-up',
  grandparent: 'a grandparent',
  aunt_or_uncle: 'an auntie or uncle',
  adult_friend: 'a grown-up friend',
  caregiver: 'a caring grown-up',
  pet: 'a pet',
  companion_object: 'a beloved toy',
};

interface PageAnalysisLike {
  setting?: string;
  /** X17.2: perception-authored short setting label ("the 4D theatre"). Used
   * RAW when present; a missing one keeps the truncated `setting` fallback. */
  settingChip?: string;
  eventSignals?: string[];
}

function readAnalysis(page: AnalyzedPageLike): PageAnalysisLike | null {
  if (!page.analysis || typeof page.analysis !== 'object') return null;
  return page.analysis as PageAnalysisLike;
}

/** Kid-role characters present in ≥ RECURRING_MIN_PAGES photos. */
export function recurringChildren(characters: RosterCharacterLike[]): RosterCharacterLike[] {
  return characters.filter(
    (c) =>
      (CHILD_ROLES as readonly string[]).includes(c.role) &&
      (c.appearsOnPages?.length ?? 0) >= RECURRING_MIN_PAGES,
  );
}

/**
 * Short human label for a roster character: their name when known, then the
 * perception-authored descriptor, a species phrase for pets/objects, else role
 * noun + one distinguishing trait. Name and descriptor pass through verbatim; the
 * distiller path is capped at 5 words so a chip never wraps and the tail is
 * stripped of any dangling punctuation (no "with big," fragments). Traits arrive
 * in English from perception regardless of book language — acceptable for data chips.
 */
export function describeCharacter(c: RosterCharacterLike): string {
  const cap = (label: string) =>
    label
      .split(/\s+/)
      .slice(0, 5)
      .join(' ')
      .replace(/[,;:、。]+$/, '');
  if (c.name?.trim()) return c.name.trim();
  if (c.descriptor?.trim()) return c.descriptor.trim();
  if (c.species?.trim()) return cap(`a ${c.species.trim()}`);
  const noun = ROLE_NOUNS[c.role] ?? 'someone special';
  const trait =
    c.physicalTraits?.distinguishingFeatures?.[0]?.trim() ||
    (c.physicalTraits?.hairColor ? `${c.physicalTraits.hairColor} hair` : '');
  return cap(trait ? `${noun} with ${trait}` : noun);
}

function truncateLabel(text: string, max = 40): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 12 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * Build the discovery chips: up to 2 distinct settings, up to 3 cast entries
 * (recurring kids first by photo count, then foreground others), up to 1
 * event signal by cross-page frequency — interleaved
 * [setting, cast, cast, signal, cast], capped at 5.
 * Settings ground the day, the cast is the emotional hook, the signal adds charm.
 * Perception-authored `settingChip` labels are used RAW; legacy `setting`
 * strings keep their truncated fallback byte-identically.
 */
export function buildDiscoveryChips(
  pages: AnalyzedPageLike[],
  characters: RosterCharacterLike[],
): DiscoveryChip[] {
  const analyses = pages
    .filter((p) => p.assetId != null)
    .map(readAnalysis)
    .filter((a): a is PageAnalysisLike => a != null);

  const settings: string[] = [];
  const seenSettings = new Set<string>();
  for (const a of analyses) {
    const chip = a.settingChip?.trim();
    const chosen = chip || a.setting?.trim();
    if (!chosen) continue;
    const key = chosen.toLowerCase();
    if (seenSettings.has(key)) continue;
    seenSettings.add(key);
    // A perception `settingChip` is a finished label — use it RAW. A legacy
    // page keeps the exact `truncateLabel(setting)` it produced before X17.2.
    if (settings.length < 2) settings.push(chip ? chip : truncateLabel(chosen));
  }

  const kids = recurringChildren(characters).sort(
    (a, b) => (b.appearsOnPages?.length ?? 0) - (a.appearsOnPages?.length ?? 0),
  );
  const others = characters.filter(
    (c) => !(CHILD_ROLES as readonly string[]).includes(c.role) && c.isForeground !== false,
  );
  const cast = [...kids, ...others].slice(0, 3);

  const signalCounts = new Map<string, { label: string; count: number; firstAt: number }>();
  analyses.forEach((a, pageIdx) => {
    for (const raw of a.eventSignals ?? []) {
      const label = raw.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seenSettings.has(key)) continue;
      const entry = signalCounts.get(key);
      if (entry) entry.count += 1;
      else signalCounts.set(key, { label: truncateLabel(label), count: 1, firstAt: pageIdx });
    }
  });
  const signals = Array.from(signalCounts.values())
    .sort((a, b) => b.count - a.count || a.firstAt - b.firstAt)
    .slice(0, 2)
    .map((s) => s.label);

  // X17.2: ambient 5-slot interleave [setting, cast, cast, signal, cast] — the
  // second setting/signal tail is dropped so the feed stays a light 5-chip peek.
  const ordered: (DiscoveryChip | null)[] = [
    settings[0] ? { id: 'setting-0', kind: 'setting', label: settings[0] } : null,
    cast[0]
      ? { id: `cast-${cast[0].characterId}`, kind: 'cast', label: describeCharacter(cast[0]) }
      : null,
    cast[1]
      ? { id: `cast-${cast[1].characterId}`, kind: 'cast', label: describeCharacter(cast[1]) }
      : null,
    signals[0] ? { id: 'signal-0', kind: 'signal', label: signals[0] } : null,
    cast[2]
      ? { id: `cast-${cast[2].characterId}`, kind: 'cast', label: describeCharacter(cast[2]) }
      : null,
  ];
  return ordered.filter((c): c is DiscoveryChip => c != null).slice(0, MAX_DISCOVERY_CHIPS);
}
