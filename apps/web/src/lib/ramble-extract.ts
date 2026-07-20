/**
 * X17 B4 — ramble extraction for photo books. One gpt-5-mini call reads the
 * parent's account of the day and pulls the facts chips would have asked
 * for. Facts return to the client, which merges them into setup state — the
 * debounced PATCH channel is the single writer, so this route never writes
 * the Book row.
 */

export interface RambleRosterEntry {
  characterId: string;
  role: string;
  name: string | null;
  descriptor: string;
}

export interface RambleExtraction {
  starName: string | null;
  people: { characterId: string | null; name: string }[];
  location: string | null;
  highlight: string | null;
  mishap: string | null;
  childSaid: string | null;
  themeLine: string | null;
}

export const RAMBLE_EXTRACT_MAX_OUTPUT_TOKENS = 600;

export const RAMBLE_EXTRACT_SYSTEM_PROMPT = [
  'You extract facts from a parent describing a real day out with their child.',
  'Rules:',
  '- Use ONLY what the parent actually wrote. Never infer or invent.',
  '- Every field is null when the parent did not say it.',
  '- starName: the child this story is about, exactly as the parent wrote the name.',
  '- people: ONLY personal names the parent actually wrote ("Kai", "Uncle Jon"). NEVER a role or relationship word (friend, uncle, parent, sibling, main_child) and NEVER an underscore token — if the parent did not name someone, OMIT them from people entirely.',
  '- location: the specific place, a few words.',
  '- highlight: the best moment, one short phrase.',
  '- mishap: a small thing that went wrong, one short phrase.',
  '- childSaid: something the child actually said, verbatim when quoted.',
  '- themeLine: ONLY when the account clearly contradicts or outgrows the current theme guess, a corrected theme of at most 8 words. Otherwise null.',
].join('\n');

export const RAMBLE_EXTRACT_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    starName: { type: ['string', 'null'] },
    people: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          characterId: { type: ['string', 'null'] },
          name: { type: 'string' },
        },
        required: ['characterId', 'name'],
      },
    },
    location: { type: ['string', 'null'] },
    highlight: { type: ['string', 'null'] },
    mishap: { type: ['string', 'null'] },
    childSaid: { type: ['string', 'null'] },
    themeLine: { type: ['string', 'null'] },
  },
  required: ['starName', 'people', 'location', 'highlight', 'mishap', 'childSaid', 'themeLine'],
} as const;

export function buildRambleExtractPrompt(input: {
  ramble: string;
  roster: RambleRosterEntry[];
  themeLine: string | null;
  language: 'en' | 'ja';
}): string {
  const rosterLines = input.roster.length
    ? input.roster
        .map(
          (r) =>
            `- ${r.characterId}: ${r.role}${r.name ? `, named ${r.name}` : ''} — ${r.descriptor}`,
        )
        .join('\n')
    : '- (no roster available)';
  return [
    'People and pets spotted in the photos:',
    rosterLines,
    `Current theme guess: ${input.themeLine?.trim() || '(none)'}`,
    input.language === 'ja'
      ? 'The parent wrote in Japanese; return extracted strings in Japanese.'
      : '',
    '',
    "The parent's account of the day:",
    input.ramble,
  ]
    .filter(Boolean)
    .join('\n');
}

const capField = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * X17.2 P0b: relationship/role words the extractor keeps returning as
 * "names" (dump: parent_or_uncle, friend, main_child, sibling). A name the
 * parent actually wrote never exact-matches this list ("Uncle Jon" passes;
 * bare "uncle" does not). Normalized: lowercase, underscores → spaces.
 */
const NON_NAME_TOKENS = new Set([
  'friend',
  'friends',
  'uncle',
  'aunt',
  'auntie',
  'parent',
  'parents',
  'cousin',
  'grandma',
  'grandpa',
  'grandmother',
  'grandfather',
  'mom',
  'mum',
  'mommy',
  'mummy',
  'dad',
  'daddy',
  'mother',
  'father',
  'brother',
  'sister',
  'sibling',
  'baby',
  'boy',
  'girl',
  'kid',
  'child',
  'children',
  'adult',
  'man',
  'woman',
  'main child',
  'parent or uncle',
  'family friend',
  'neighbor',
  'neighbour',
  'teacher',
  'babysitter',
  'caregiver',
  // ja equivalents (compact — no spaces)
  'ともだち',
  'おともだち',
  'おじさん',
  'おばさん',
  'おかあさん',
  'おとうさん',
  'おばあちゃん',
  'おじいちゃん',
  'おにいちゃん',
  'おねえちゃん',
  'いもうと',
  'おとうと',
  'あかちゃん',
  'せんせい',
]);

// Built via `new RegExp` (not a literal) so the Unicode `u` flag is not
// rejected under the web app's es5 tsc target; Node and SWC support it at runtime.
const HAS_LETTER = new RegExp('\\p{L}', 'u');

/** True when a string plausibly IS a personal name the parent wrote. */
export function isLikelyPersonName(raw: string): boolean {
  const name = raw.trim();
  if (!name || name.length > 50) return false;
  if (name.includes('_')) return false;
  if (!HAS_LETTER.test(name)) return false;
  const norm = name.toLowerCase().replace(/\s+/g, ' ');
  if (NON_NAME_TOKENS.has(norm) || NON_NAME_TOKENS.has(norm.replace(/ /g, ''))) return false;
  if (norm.split(' ').length > 4) return false;
  return true;
}

/** Model output is untrusted — every bound is enforced here, not in the schema. */
export function sanitizeRambleExtraction(raw: unknown, rosterIds: string[]): RambleExtraction {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const idSet = new Set(rosterIds);
  const people = Array.isArray(obj.people)
    ? (obj.people as unknown[])
        .map((p) => {
          const entry = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
          const name = capField(entry.name, 50);
          if (!name) return null;
          if (!isLikelyPersonName(name)) return null;
          const characterId =
            typeof entry.characterId === 'string' && idSet.has(entry.characterId)
              ? entry.characterId
              : null;
          return { characterId, name };
        })
        .filter((p): p is { characterId: string | null; name: string } => p != null)
        .slice(0, 6)
    : [];
  return {
    starName: (() => {
      const s = capField(obj.starName, 50);
      return s && isLikelyPersonName(s) ? s : null;
    })(),
    people,
    location: capField(obj.location, 120),
    highlight: capField(obj.highlight, 200),
    mishap: capField(obj.mishap, 200),
    childSaid: capField(obj.childSaid, 200),
    themeLine: capField(obj.themeLine, 120),
  };
}
