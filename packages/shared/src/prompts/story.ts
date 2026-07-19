// ----------------------------------
// IMPORTS & TYPES
// ----------------------------------

// Prompt part types for multi-modal story generation
export interface TextPart {
  text: string;
}
export interface ImagePlaceholder {
  type: 'image_placeholder';
  imageUrl: string;
  pageNumber: number;
}
export type StoryPromptPart = TextPart | ImagePlaceholder;

// STORY QUALITY V2: the beat sheet is generated BEFORE the pages array
// (strict-mode output follows schema property order), so the model commits
// the full structural plan before writing a word of prose — the same page
// order the photos arrive in; beats are assigned, never reordered.
const BEAT_SHEET_SCHEMA = {
  type: 'array',
  description:
    'One beat per page, planned BEFORE writing any page text — the structural spine the pages must deliver',
  items: {
    type: 'object',
    properties: {
      pageNumber: { type: 'number', description: 'The 1-based page number this beat belongs to' },
      role: {
        type: 'string',
        enum: ['setup', 'complication', 'try', 'breath', 'turn', 'climax', 'resolution'],
        description: "This page's single structural job in the story",
      },
      goal: {
        type: 'string',
        description:
          'The one thing this page does for the throughline (one line, e.g. "first try fails — the branch is too short")',
      },
      handoff: {
        type: ['string', 'null'],
        description:
          'What this page ends on that leans into the next page. Null ONLY on the final page.',
      },
    },
    required: ['pageNumber', 'role', 'goal', 'handoff'],
    additionalProperties: false,
  },
} as const;

// Page-item fields shared by the photo and avatar response schemas. The
// avatar variant adds `scene`; the photo variant adds `moodCue`.
const PAGE_ITEM_PROPERTIES = {
  pageNumber: {
    type: 'number',
    description: 'The 1-based page number',
  },
  text: {
    type: 'string',
    description: 'The story text for this page (1-2 sentences, 15-30 words)',
  },
  illustrationNotes: {
    type: ['string', 'null'],
    description: 'Visual effects suggestion for the illustration, or null if none',
  },
  learningWordsUsed: {
    type: 'array',
    items: { type: 'string' },
    description:
      "Which of the LEARNING WORDS (verbatim) appear in this page's text. Empty array when none or when no learning words were given.",
  },
} as const;

const PAGE_ITEM_REQUIRED = [
  'pageNumber',
  'text',
  'illustrationNotes',
  'learningWordsUsed',
] as const;

// JSON Schema for OpenAI structured output (strict mode)
// Array-based format: { pages: [{ pageNumber, text, illustrationNotes }, ...] }
// NOTE: bridge pages are requested via STORY_RESPONSE_SCHEMA_WITH_BRIDGES
// only when BRIDGE_PAGES_ENABLED.
export const STORY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    storyArc: {
      type: 'object',
      description: 'Plan the story arc BEFORE writing pages — this shapes the narrative',
      properties: {
        desire: {
          type: 'string',
          description: 'What does the child want, discover, or set out to do? (1 sentence)',
        },
        obstacle: {
          type: 'string',
          description:
            'The one thing in the way of the desire — a problem to solve, a fear to face, something lost, a goal that resists. This is what makes it a story, not a tour. (1 sentence)',
        },
        throughline: {
          type: 'string',
          description:
            'The ONE connective spine of the book: the single problem/goal plus the recurring object or question that is planted in the SITUATION pages and paid off in the RESOLUTION. (1 sentence)',
        },
        tryAndOvercome: {
          type: ['string', 'null'],
          description:
            'How the child TRIES, wobbles, and tries again before it works — the doing that earns the payoff. Null only if this story genuinely has no obstacle to overcome. (1 sentence)',
        },
        refrain: {
          type: 'string',
          description:
            'A 4-8 word phrase that will recur 3+ times with variation throughout the story',
        },
        emotionalPeak: {
          type: 'string',
          description:
            'The moment of biggest feeling — wonder, triumph, laughter, or warmth (1 sentence)',
        },
        resolution: {
          type: 'string',
          description:
            "How does the story land — the payoff the child feels? The goal reached and the wish granted for an adventure, or a warm bedtime hush for a sweet or sleepy story (match the story's own energy). (1 sentence)",
        },
      },
      required: [
        'desire',
        'obstacle',
        'throughline',
        'tryAndOvercome',
        'refrain',
        'emotionalPeak',
        'resolution',
      ],
      additionalProperties: false,
    },
    beatSheet: BEAT_SHEET_SCHEMA,
    suggestedTitle: {
      type: 'string',
      description:
        'A short, evocative book title (2-6 words) in the story language. Suggest one even if a title was provided.',
    },
    pages: {
      type: 'array',
      description: 'Story text and illustration notes for each page',
      items: {
        type: 'object',
        properties: {
          ...PAGE_ITEM_PROPERTIES,
          moodCue: {
            type: ['string', 'null'],
            description:
              'How this page\'s moment should FEEL in the picture, in 1-3 words ("hushed wonder", "giddy triumph") — steers lighting, atmosphere, and expression emphasis ONLY, never pose or composition. Null when genuinely neutral.',
          },
        },
        required: [...PAGE_ITEM_REQUIRED, 'moodCue'],
        additionalProperties: false,
      },
    },
  },
  required: ['storyArc', 'beatSheet', 'suggestedTitle', 'pages'],
  additionalProperties: false,
} as const;

// Bridge pages (BRIDGE_PAGES_ENABLED): app-authored in-between pages the
// model may insert where a narrative beat is missing between two photos.
// An insertion list — the photo `pages[]` contract above is untouched.
const BRIDGE_PAGES_SCHEMA = {
  type: 'array',
  description:
    'OPTIONAL bridge pages — extra pages WITHOUT a photo, inserted only where a narrative beat is genuinely missing. Most books need ZERO: return an empty array.',
  items: {
    type: 'object',
    properties: {
      afterPhotoPage: {
        type: 'number',
        description:
          'The 1-based storyboard page this bridge follows (the last page number = a wind-down after the final photo). Never before the first photo.',
      },
      text: {
        type: 'string',
        description: 'The story text for this bridge page (same rules as every page)',
      },
      learningWordsUsed: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Which of the LEARNING WORDS (verbatim) appear in this bridge text. Empty array when none.',
      },
      illustrationNotes: {
        type: ['string', 'null'],
        description: 'Visual effects suggestion for the illustration, or null if none',
      },
      scene: {
        type: 'object',
        description: 'Structured continuity record — the illustrator has NO photo for this page',
        properties: {
          location: {
            type: 'string',
            description:
              'Where this moment happens — plausibly between the adjacent photos’ settings',
          },
          timeOfDay: { type: 'string', description: 'e.g. "morning", "golden afternoon"' },
          action: {
            type: 'string',
            description: 'What the characters are DOING in this new moment',
          },
          charactersPresent: {
            type: 'array',
            items: { type: 'string' },
            description: 'characterIds from the roster — ONLY people/pets from the roster',
          },
          outfitFrom: {
            type: 'string',
            enum: ['previous', 'next'],
            description: 'Which adjacent photo the outfits come from',
          },
          props: {
            type: 'array',
            items: { type: 'string' },
            description: 'Concrete objects carried over from the adjacent photos',
          },
          mood: {
            type: ['string', 'null'],
            description:
              "1-3 words for how this moment should FEEL in the picture ('hushed wonder'); null when neutral",
          },
          focus: {
            type: ['string', 'null'],
            description:
              'Who + what owns this composition ("Emma reaching for the branch"); null when no single focus',
          },
        },
        required: [
          'location',
          'timeOfDay',
          'action',
          'charactersPresent',
          'outfitFrom',
          'props',
          'mood',
          'focus',
        ],
        additionalProperties: false,
      },
    },
    required: ['afterPhotoPage', 'text', 'illustrationNotes', 'learningWordsUsed', 'scene'],
    additionalProperties: false,
  },
} as const;

/**
 * Strict-mode variant requested ONLY when BRIDGE_PAGES_ENABLED: identical to
 * STORY_RESPONSE_SCHEMA plus a required `bridgePages` array (empty = none).
 */
export const STORY_RESPONSE_SCHEMA_WITH_BRIDGES = {
  ...STORY_RESPONSE_SCHEMA,
  properties: {
    ...STORY_RESPONSE_SCHEMA.properties,
    bridgePages: BRIDGE_PAGES_SCHEMA,
  },
  required: [...STORY_RESPONSE_SCHEMA.required, 'bridgePages'],
} as const;

// Simplified Input Type - Expects pre-filtered/sorted pages
export interface StoryGenerationInput {
  bookTitle: string;
  isDoubleSpread: boolean;
  artStyle?: string;
  childName?: string;
  additionalCharacters?: { name: string; relationship: string }[];
  tone?: string; // Story mood e.g. "adventurous", "silly", "sweet"
  theme?: string; // Story context e.g. "Our trip to the beach"
  language?: string; // "en" | "ja", defaults to "en"
  suggestTitle?: boolean; // True when the current title is a placeholder — the model's suggestedTitle will be used
  qcFeedback?: string; // Editorial corrections from a failed story-QC round, injected on regeneration
  eventSummary?: string; // Parent-confirmed "what actually happened" brief. When present it REPLACES theme in the prompt.
  confirmedFacts?: string[]; // Parent's tapped answers to photo-derived questions ("This was Emma's first beach trip")
  /** X17 B4: confirmed facts bound to a page (1-based pageNumber) — rendered
   * on that page's WHAT'S HERE line; the global confirmedFacts list should
   * then exclude them. */
  pageBoundFacts?: Record<number, string[]>;
  /** Parent-supplied words the child is learning (max 4). Woven 3-4x each. */
  learningWords?: string[];
  charactersInPhotos?: {
    /** Stable roster id — bridge pages reference characters by this id. */
    characterId?: string;
    name: string;
    role: string;
    appearsOnPages: number[]; // empty = present in the photos, but exact pages unknown (page-less prompt variant)
    namedVia?: 'chip' | 'childName' | 'fallback'; // provenance of `name`; chip/childName = parent-confirmed, must appear verbatim
  }[]; // From the perception pass — who actually appears where
  /**
   * X17 A2 (ENSEMBLE_BOOKS_ENABLED): 'ensemble' replaces the single-star
   * character instruction with one crew block — every confirmed member woven
   * in equally, rotating spotlight, shared refrain. Absent/'star' keeps
   * today's prompt byte-identical. PHOTO builder only — never the avatar
   * builder (its cast rides buildAvatarCastForPrompt). NOTE: do not write the
   * literal crew-header string in this comment — the Step 4 grep asserts it
   * appears exactly once in this file, inside the prompt builder.
   */
  castMode?: 'star' | 'ensemble';
  /**
   * BRIDGE_PAGES_ENABLED: maximum bridge pages the model may propose
   * (code-enforced again in the worker). 0/undefined = no bridge section in
   * the prompt and no bridgePages in the response schema — the legacy prompt
   * stays byte-identical.
   */
  bridgeCap?: number;
  /**
   * X13 Track T (TOYS_COME_ALIVE_ENABLED, default absent/false = today's
   * prompt byte-identical): flips the companion-object register. Off, a
   * beloved toy "never walks, talks, or acts on its own"; on, it is brought
   * to life — it moves, reacts, has feelings, and adventures side by side,
   * while staying recognizably itself. REAL PETS are untouched either way.
   */
  toysComeAlive?: boolean;
  storyPages: {
    pageId: string;
    pageNumber: number;
    assetId: string | null;
    originalImageUrl: string | null;
    analysis?: {
      setting: string;
      action: string;
      emotion: string;
      eventSignals: string[];
      narrativeRole: string;
    } | null; // Perception-pass output for this photo, when fresh
  }[];
}

// ----------------------------------
// SYSTEM PROMPT (StoryGen)
// ----------------------------------

export const STORY_GENERATION_SYSTEM_PROMPT = `You are an expert children's picture-book author for children ages 3-5. Parents read your stories aloud. Every book is a real little adventure — a beginning, a problem, and a satisfying end.

CRITICAL MINDSET — You are a STORYTELLER, not a photo captioner:
- Photos are INSPIRATION, not subjects. A photo of a child at the park should spark a narrative moment (wonder, mischief, discovery) — NOT a description of "a child standing in the park."
- Every page must advance the STORY — an emotional journey with desire, tension, and resolution.
- If you find yourself describing what's visible in a photo, STOP and rewrite from the child's inner experience.

Your north star: Would a parent want to re-read this 100 times? That requires emotional truth, rhythm, and a refrain worth repeating.`;

// ----------------------------------
// STORY GENERATION PROMPT
// ----------------------------------

// X17 B4 — page binding of confirmed facts -------------------------------

export interface FactBindingPage {
  /** 1-based pageNumber, matching storyPages[].pageNumber. */
  position: number;
  eventSignals?: string[];
}

const FACT_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'with',
  'was',
  'were',
  'our',
  'his',
  'her',
  'their',
  'then',
  'that',
  'this',
  'from',
  'into',
  'onto',
  'when',
  'while',
]);

function factTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !FACT_STOPWORDS.has(w)),
  );
}

/**
 * Bind each confirmed fact to the single page whose eventSignals share the
 * most content tokens (≥1 token of ≥4 chars). Bound facts anchor the moment
 * to the right photo; facts with no overlap stay global. Purely lexical and
 * deterministic — ja text (no space-delimited words) falls through to
 * global, which is today's behavior.
 */
export function bindFactsToPages(
  facts: string[],
  pages: FactBindingPage[],
): { bound: Record<number, string[]>; unbound: string[] } {
  const bound: Record<number, string[]> = {};
  const unbound: string[] = [];
  const pageTokens = pages.map((p) => ({
    position: p.position,
    tokens: factTokens((p.eventSignals ?? []).join(' ')),
  }));
  for (const fact of facts) {
    const tokens = factTokens(fact);
    let best: { position: number; overlap: number } | null = null;
    for (const page of pageTokens) {
      let overlap = 0;
      for (const token of tokens) if (page.tokens.has(token)) overlap += 1;
      if (overlap > 0 && (!best || overlap > best.overlap)) {
        best = { position: page.position, overlap };
      }
    }
    if (best) (bound[best.position] ??= []).push(fact);
    else unbound.push(fact);
  }
  return { bound, unbound };
}

export function createStoryGenerationPrompt(input: StoryGenerationInput): StoryPromptPart[] {
  const parts: StoryPromptPart[] = [];

  // ---------- CONFIG ----------
  parts.push({
    text: `# Configuration\nBook Title: ${
      input.bookTitle || 'My Special Story'
    }\nPage Count: ${input.storyPages.length}`,
  });

  // ---------- STORYBOARD (IMAGES) ----------
  parts.push({ text: '# Storyboard Sequence' });

  // A parent reorder can leave per-photo ARC ROLE hints contradicting the
  // current sequence; drop them book-wide when the ordering is implausible.
  const arcHintsUsable = arcRoleHintsUsable(input.storyPages.map((p) => p.analysis?.narrativeRole));

  input.storyPages.forEach((page) => {
    parts.push({ text: `--- Page ${page.pageNumber} ---` });
    if (page.originalImageUrl) {
      parts.push({
        type: 'image_placeholder',
        imageUrl: page.originalImageUrl,
        pageNumber: page.pageNumber,
      });
    } else {
      parts.push({
        text: `[No Image Provided for Page ${page.pageNumber}]`,
      });
    }
    if (page.analysis) {
      const signals = page.analysis.eventSignals?.length
        ? ` Signals: ${page.analysis.eventSignals.join(', ')}.`
        : '';
      const arcRole = arcHintsUsable ? ` ARC ROLE: ${page.analysis.narrativeRole}.` : '';
      const boundFacts = input.pageBoundFacts?.[page.pageNumber];
      const parentFacts = boundFacts?.length ? ` Parent confirmed: ${boundFacts.join('; ')}.` : '';
      parts.push({
        text: `WHAT'S HERE (raw notes, NOT the story): ${page.analysis.setting}; ${page.analysis.action}; ${page.analysis.emotion}.${signals}${arcRole}${parentFacts}`,
      });
    }
  });
  parts.push({ text: '--- End Storyboard ---' });

  // ---------- INSTRUCTIONS ----------
  // X17 A2: ensemble books star EVERYONE — one CREW block instead of a star
  // line plus supporting cast. Star books (castMode absent/'star') keep the
  // pre-X17 build byte-identically.
  const ensembleCrew =
    input.castMode === 'ensemble' && input.charactersInPhotos?.length
      ? input.charactersInPhotos
      : null;

  let characterInstruction: string;
  if (ensembleCrew) {
    characterInstruction = `  - THE CREW (an ensemble book — it stars ALL of them equally, not one child with a supporting cast):`;
    for (const c of ensembleCrew) {
      const isPet = c.role === 'pet';
      const isObject = c.role === 'companion_object';
      const confirmedName =
        c.namedVia === 'chip' || c.namedVia === 'childName'
          ? ` The parent confirmed this ${isObject ? "object's" : isPet ? "pet's" : "person's"} name: call ${isObject ? 'it' : 'them'} "${c.name}" in the story text.`
          : '';
      const petNote = isPet
        ? ` They are the family's animal companion — keep them a real animal (sounds, wags, nuzzles), never a talking character.`
        : '';
      const objectNote = isObject
        ? input.toysComeAlive
          ? ` It is the crew's beloved toy, brought to life for this adventure — it moves, plays, reacts, and has feelings of its own; it stays recognizably itself, never turned into a person.`
          : ` It is the crew's beloved object — it can be hugged, carried, dropped, lost and found, tucked in; it never walks, talks, or acts on its own.`
        : '';
      const where =
        c.appearsOnPages.length > 0
          ? `appears on page(s) ${c.appearsOnPages.join(', ')}`
          : `appears in several of the photos (exact pages unknown — include them only where you can SEE them in the storyboard images)`;
      characterInstruction += `\n    - ${c.name} (${c.role.replace(/_/g, ' ')}) ${where}.${confirmedName}${petNote}${objectNote}`;
    }
    characterInstruction += [
      ``,
      `    - Rotate the spotlight: EVERY named crew member drives at least one page's beat — an action, a discovery, a decision that moves the story forward (not a wave from the background).`,
      `    - No member disappears: where a member's photos allow it, never leave a named member out of the text for a long stretch — bring them back within a page or two of their photo appearances.`,
      `    - The refrain belongs to the whole crew: let different members carry or answer it across the book.`,
      `    - Never invent appearances: a character speaks or acts on a page ONLY if they are actually on that page (or plausibly just off-frame on an adjacent one).`,
    ].join('\n');
  } else {
    // ---- pre-X17 star branch, UNCHANGED ----
    // Build character instruction dynamically based on provided names
    if (input.childName) {
      characterInstruction = `  - The main character is named "${input.childName}". Use this name directly in the story text.`;
      if (input.additionalCharacters && input.additionalCharacters.length > 0) {
        const charList = input.additionalCharacters
          .map((c) => `"${c.name}" (${c.relationship})`)
          .join(', ');
        characterInstruction += `\n  - Other characters who may appear: ${charList}. Identify which characters appear in each photo and use their names appropriately.`;
      }
    } else {
      // Fallback to generic terms if no child name provided
      characterInstruction = `  - Use descriptive terms like "the child", "the little one", etc.`;
    }

    // Supporting-cast weaving: the perception pass knows who appears on which
    // pages, so recurring family members get real roles instead of cameos.
    // Characters with an empty appearsOnPages survived a photo change but their
    // exact pages are unknown — they get the page-less variant instead of
    // asserted (possibly wrong) page numbers.
    if (input.charactersInPhotos?.length) {
      const supporting = input.charactersInPhotos.filter((c) => c.role !== 'main_child');
      if (supporting.length > 0) {
        characterInstruction += `\n  - SUPPORTING CAST (from the actual photos — weave them in, don't just mention them):`;
        for (const c of supporting) {
          const isPet = c.role === 'pet';
          const isObject = c.role === 'companion_object';
          const confirmedName =
            c.namedVia === 'chip' || c.namedVia === 'childName'
              ? ` The parent confirmed this ${isObject ? "object's" : isPet ? "pet's" : "person's"} name: call ${isObject ? 'it' : 'them'} "${c.name}" in the story text.`
              : '';
          const petNote = isPet
            ? ` They are the family's animal companion — keep them a real animal (sounds, wags, nuzzles), never a talking character.`
            : '';
          const objectNote = isObject
            ? input.toysComeAlive
              ? ` It is the child's beloved toy, brought to life for this adventure — it moves, plays, reacts, and has feelings of its own, adventuring right beside ${input.childName || 'the child'}; it may even speak when the story wants it to. A true companion in the action, yet it stays recognizably itself — the same beloved toy, never turned into a person. Let it share the emotional beats: comfort at the quiet moment, cheer at the landing.`
              : ` It is the child's beloved object — it can be hugged, carried, dropped, lost and found, tucked in; it never walks, talks, or acts on its own. Let it anchor emotional beats (comfort at the quiet moment, joining the landing).`
            : '';
          const supportingRole = isObject
            ? `Weave it in as a treasured companion`
            : `Give them a real supporting role`;
          if (c.appearsOnPages.length > 0) {
            characterInstruction += `\n    - ${c.name} (${c.role.replace(/_/g, ' ')}) appears on page(s) ${c.appearsOnPages.join(', ')}. ${supportingRole}${
              isObject
                ? ` where it appears.`
                : ` in the story: introduce them naturally when they first appear, involve them in at least one emotional beat (a shared laugh, a steadying hand, a discovery together), and if they are present near the end, include them in the landing.`
            }${confirmedName}${petNote}${objectNote}`;
          } else {
            characterInstruction += `\n    - ${c.name} (${c.role.replace(/_/g, ' ')}) appears in several of the photos (exact pages unknown). ${supportingRole}${
              isObject
                ? ` wherever you can SEE it in the storyboard images.`
                : ` wherever you can SEE them in the storyboard images: introduce them naturally where they first appear, and involve them in at least one emotional beat.`
            }${confirmedName}${petNote}${objectNote}`;
          }
        }
        characterInstruction += `\n    - Never invent appearances: a character speaks or acts on a page ONLY if they are actually on that page (or plausibly just off-frame on an adjacent one).`;
        if (supporting.some((c) => c.appearsOnPages.length === 0)) {
          characterInstruction += ` For characters whose exact pages are unknown, include them only on pages where you can actually see them in the storyboard images.`;
        }
      }
    }
  }

  // Name discipline: names come from the parent, never from the model.
  characterInstruction += [
    ``,
    `  - NEVER invent a proper name for anyone. Use ONLY the names given above.`,
    `  - For unnamed people, use the warm relationship word a toddler would say — "Grandma", "Grandpa", "Daddy", "Mummy", "Auntie", "the little sister" — based on their listed role. If the relationship is unclear, use a neutral warm term like "a friend".`,
    `  - For unnamed pets, use simple animal words ("the dog", "the cat"). For unnamed beloved objects, use simple object words ("her bunny", "the blanket"). Never name a pet or object the parent didn't name. A pet or object the parent DID name is a character too — use that name.`,
    `  - At most TWO named characters ACT in any page's text. Others may appear in the picture — but never roll-call the cast ("A does X, B does Y, and C does Z" is the pattern to avoid).`,
  ].join('\n');

  // BRIDGE PAGES (BRIDGE_PAGES_ENABLED): rendered only when the worker set a
  // positive cap AND the roster carries characterIds (identity-less books
  // must never get bridges — there is nothing to ground them to).
  const bridgeRoster = (input.charactersInPhotos ?? []).filter((c) => c.characterId);
  const bridgeSection =
    input.bridgeCap && input.bridgeCap > 0 && bridgeRoster.length > 0
      ? [
          ``,
          `## BRIDGE PAGES (optional — most books need ZERO):`,
          `- You may add up to ${input.bridgeCap} bridge page(s) — an extra page WITHOUT a photo — but ONLY where a narrative beat is genuinely missing between two adjacent photos (a journey, an approach, an anticipation) or as a wind-down AFTER the last photo. A bridge exists to make the page-turn feel inevitable, never to pad. Report them in the "bridgePages" array; return an empty array when none are needed (the usual case).`,
          `- At most ONE bridge per gap, and never before the first photo. "afterPhotoPage" is the storyboard page the bridge follows (${input.storyPages.length} = after the last photo).`,
          `- GROUNDING (non-negotiable): a bridge may show ONLY people and pets from this roster, referenced by characterId in "scene.charactersPresent":`,
          ...bridgeRoster.map(
            (c) =>
              `    - characterId "${c.characterId}" = ${c.name} (${c.role.replace(/_/g, ' ')})`,
          ),
          `- Never invent a person, a pet, or a named place. The setting must sit plausibly BETWEEN the adjacent photos' settings (use their WHAT'S HERE notes); the action must grow out of what the adjacent photos actually show. Set "scene.outfitFrom" to whichever adjacent photo the outfits should copy.`,
          `- Give each bridge scene a "mood" (1-3 feeling words) and a "focus" (who + what owns the composition) — the illustrator has NO photo for this page, so these two lines are its only emotional and compositional steer.`,
          `- Bridge text follows every rule in this prompt (refrain, hand-off, length limits) and must read as part of the same continuous story.`,
        ].join('\n')
      : '';

  // X16 W1: signals that recur across photos are throughline fuel — surface
  // them ONCE as candidates instead of leaving recurrence detection to the
  // model across N images. Single-occurrence signals stay on their page line.
  const signalPages = new Map<string, { label: string; pages: number[] }>();
  for (const p of input.storyPages) {
    for (const s of p.analysis?.eventSignals ?? []) {
      const key = s.trim().toLowerCase();
      if (!key) continue;
      const entry = signalPages.get(key) ?? { label: s.trim(), pages: [] };
      entry.pages.push(p.pageNumber);
      signalPages.set(key, entry);
    }
  }
  const throughlineCandidates = [...signalPages.values()].filter((e) => e.pages.length >= 2);
  const throughlineSection = throughlineCandidates.length
    ? [
        `## Throughline candidates seen in the photos:`,
        ...throughlineCandidates.map((e) => `- "${e.label}" (pages ${e.pages.join(', ')})`),
        `- These objects/moments recur in the actual photos. Prefer ONE of them as the planted throughline object — plant it in the SITUATION, let it return, and pay it off in the RESOLUTION.`,
        ``,
      ]
    : [];

  const baseInstructions = [
    `# Instructions & Guiding Principles:`,
    `- Imagine a parent curled up with their child, reading aloud. Every sentence should feel warm, playful, and alive in a parent's voice.`,
    `- Write from the **toddler's perspective** — what they see, feel, touch, hear, and wonder about. Ground every moment in their sensory experience.`,
    ``,
    `## ANTI-CAPTION RULE (critical):`,
    `- NEVER describe what's literally visible in the photo like a caption. Instead, narrate what the child FEELS, IMAGINES, or DISCOVERS in that moment.`,
    `- BAD: "Kai is at the beach. He sees the waves." (this is a caption)`,
    `- GOOD: "The waves whisper a secret — come closer, come closer! Kai wiggles his toes in the sand." (this is a story)`,
    `- Each page must contain at least one element that goes BEYOND the photo: an internal feeling, a question, a sensory detail, or an imaginative leap.`,
    ``,
    `## Narrative Architecture — ONE problem, escalating tries, an earned payoff:`,
    `- **The child is the DOER**: give them one clear goal, one thing in the way, and let them TRY, wobble, and try again before it works. The child acts ON the world — not just moving through it. That trying is what makes a story fun instead of a tour.`,
    `- **SITUATION** (first ~20% of pages): establish the child's world AND the one desire or problem this book is about. Plant the throughline here — the recurring object, question, or quest the whole story hangs on (name it in "storyArc.throughline"). If the title names a thing, it appears in this stretch, never sprung near the end.`,
    `- **COMPLICATION & TRIES** (the middle): the SAME problem pushes back, and each try ESCALATES — bigger, closer, braver. NEVER stage a new, unrelated set-piece on each page; obstacle after unconnected obstacle is a tour, not a story. This is where the refrain repeats and evolves.`,
    `- **TURN** (about 3/4 through): the hardest moment — the try that almost fails. Let it wobble hardest here.`,
    `- **Mishap (for adventurous or silly tones)**: plant one small physical mishap early — a drop, a slip, a wrong turn — and let it repeat or pay off. Surprise is what makes a child request the book again. In short books (4-5 pages) the "try" beat carries the wobble — never skip it.`,
    `- **RESOLUTION** (final 1-2 pages): the child's OWN action pays off the throughline, and the feeling lands with a warm exhale — the last page a parent lingers on. Only sweet or sleepy stories drift into a bedtime hush; an adventure earns a satisfied, wide-awake glow. Read the story's own energy to choose which — never ask the parent. The climax's payoff must be COMPLETE before the final page begins — but the climax page itself must not end on the completed payoff; its last clause opens the door to the landing.`,
    `- NEVER end with "What a wonderful day" or similar summary statements. Let the accumulated feeling speak for itself.`,
    `- Where pages carry an ARC ROLE note, use it: "opening" pages plant the desire, "rising" pages escalate, a "peak" page carries the emotional high point, "quiet" pages are a breath of tenderness, "closing" pages land the story. The roles are suggestions from the photos — honor their shape even while you interpret freely.`,
    ``,
    `## BEAT SHEET (required — plan it BEFORE any page text, in "beatSheet"):`,
    `- Assign every page exactly ONE beat: "setup", "complication", "try", "breath", "turn", "climax", or "resolution".`,
    `- The photos are in fixed order — NEVER reorder them. Map the throughline ONTO the given sequence; the ARC ROLE notes are your beat hints (opening→setup, rising→try, peak→turn or climax, quiet→breath, closing→resolution).`,
    `- "goal": the single job that page does for the throughline (one line). "handoff": what leans into the next page (null ONLY on the final page).`,
    `- Every "try" beat escalates the SAME problem. If a beat's goal could belong to a different book, it is wrong.`,
    `- Then write each page to DELIVER its beat — a page that ignores its declared beat fails editorial review.`,
    ``,
    ...throughlineSection,
    `## PAGE-TO-PAGE FLOW (critical — photos alone rarely tell a story):`,
    `- **Connective device**: If the photos read as a montage of separate moments rather than one continuous event, choose ONE thread and pull every page through it: a wondering question the child carries ("will the waves say hello back?"), a tiny quest, something the child is collecting or counting, or the refrain itself acting as a heartbeat. Never let pages sit side by side unconnected.`,
    `- **Hand-off rule**: Every page except the last must END with something that leans into the next page — a shadow slipping across the floor, a glance toward something new, a question, an "and then...?" energy (a sound getting closer can work too, but don't lean on it). The listener should NEED the page turn. The CLIMAX page especially must not end on the completed payoff sentence.`,
    `- **Callbacks**: In the RESOLUTION, echo one concrete detail from the SITUATION pages (an object, a gesture, the refrain in its softest form). This is what makes a story feel whole instead of a list of moments. A named person present in the SITUATION pages (Mummy, Grandma) must be present or explicitly echoed on the final page — the landing belongs to the family, not the child alone.`,
    ...(bridgeSection ? [bridgeSection] : []),
    ``,
    `## Recurring Refrain (REQUIRED):`,
    `- Create a short phrase (4-8 words) that echoes through the story at least 3 times.`,
    `- Vary it slightly each time — change one word, add emphasis, or whisper it the last time.`,
    `- At least TWO echoes must be standalone narrator lines — their own sentence, OUTSIDE any quotation marks. At most ONE echo may live inside a character's dialogue. The parent needs a chantable line, not contorted speech.`,
    `- Great refrains feel like a heartbeat — reach for an action, a feeling, or the child's name: "One more step, brave Kai!" → "Two more steps, brave Kai!" → "You did it, brave Kai!". At most one sound-based refrain per book, and only if it truly earns its place.`,
    `- Report this phrase in the "storyArc.refrain" field.`,
    ``,
    ...(input.learningWords?.length
      ? [
          `## LEARNING WORDS (the parent is teaching these — weave, never force):`,
          `- The parent says ${input.childName || 'the child'} is learning these words right now: ${input.learningWords
            .slice(0, 4)
            .map((w) => `"${w}"`)
            .join(', ')}.`,
          `- Weave EACH word into the story 3-4 times, naturally — vary the sentence frame each time, exactly like the refrain.`,
          `- Place at least one occurrence of each word at the END of a sentence in a predictable slot, so the reading parent can pause and let the child say it.`,
          `- Prefer sentences that also contain ${input.childName ? `"${input.childName}"` : "the child's name"} — words land best next to the child's own name.`,
          `- At most ONE learning word per page. Never stack two on the same page, never repeat a word twice in one sentence, never bend the story to fit a word — a word that doesn't fit this story is better used 3 times than forced 4.`,
          `- For each page, report exactly which learning words its text contains in "learningWordsUsed" (verbatim strings from the list above; empty array when none).`,
          ``,
        ]
      : []),
    `## Voice & Rhythm (critical for read-aloud quality):`,
    `- **Vary sentence structure**: mix short punchy fragments ("Up, up, up!") with slightly longer flowing sentences. Avoid monotonous Subject-Verb-Object patterns.`,
    `- **Sound words are one spice among many** — reach for a vivid verb or an image first. Use AT MOST one sound word per page, and never as the page's main event.`,
    `- Sentences should have a **musical quality** when read aloud — rhythm matters more than vocabulary.`,
    `- Use concrete nouns and action verbs. No abstractions. One idea per sentence.`,
    `- **Physical truth**: feats stay within a preschooler's real body. If the child soars, flies, or does the impossible, frame it explicitly as imagination or play — never literal.`,
    ``,
    `## Dialogic Moments:`,
    `- Include 2-3 questions across the whole book that invite the listening child to participate: "Can you see...?", "What do you think happens next?", "What do YOU think is behind the door?"`,
    `- Place these naturally — never more than one per page, and never on the final page.`,
    ``,
    `## Emotional Texture:`,
    `- Capture the **small moments** that make a toddler's day magical — the wonder of a new texture, the thrill of a puddle, the safety of a parent's hand.`,
    `- Show emotions through **actions and senses**, not labels: instead of "Kai was happy", write "Kai's eyes go wide. He squeezes Mama's hand tight."`,
    `- Include **gentle humor** that comes from the SITUATION, not sound effects — a silly predicament, a small joke that repeats and grows each time, or a character's surprised reaction.`,
    ``,
    `## Characters:`,
    characterInstruction,
    `  - Book Title: "${input.bookTitle || '(Not Provided)'}"`,
    ``,
    `## Title:`,
    input.suggestTitle
      ? `- The parent has NOT chosen a title yet — your "suggestedTitle" WILL become the book's title. Make it short (2-6 words), warm, and specific to this story${input.language === 'ja' ? ', written in Japanese (hiragana/katakana, no kanji)' : ''}. Avoid generic titles like "A Special Day".`
      : `- The parent chose the title above. Still provide a "suggestedTitle" as an alternative, but the story should honor the existing title.`,
    ``,
    ...(input.qcFeedback
      ? [
          `## CRITICAL CORRECTIONS (from editorial review of your previous draft):`,
          `- A previous draft of this story failed editorial review. You MUST address every point below in this rewrite:`,
          input.qcFeedback
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n'),
          ``,
        ]
      : []),
    ...(input.tone
      ? [
          `## Story Mood (picked by the parent):`,
          `- The parent asked for a **"${input.tone}"** telling. Let it steer word choice, pacing, and the energy of the peak. The mood is a promise to the parent, not a garnish.`,
          ``,
        ]
      : []),
    // Exactly ONE experience-context block reaches the prompt: the confirmed
    // eventSummary supersedes the legacy free-text theme when present.
    ...(input.eventSummary
      ? [
          `## What actually happened (confirmed by the parent — this is the heart of the story):`,
          `- "${input.eventSummary}"`,
          ...(input.confirmedFacts?.length
            ? input.confirmedFacts.map((f) => `- Parent confirmed: ${f}`)
            : []),
          `- The story must feel TRUE to this. It should inform the desire, the peak, and the landing — not appear as a one-line mention.`,
          ``,
        ]
      : input.theme
        ? [
            `## Story Context:`,
            `- The parent described this story as: **"${input.theme}"**. Weave this context into the narrative — it should inform the story arc, not just be mentioned once.`,
            ``,
          ]
        : []),
    `## Length:`,
    `- **1-2 sentences per page, 15-30 words** (for the ${input.storyPages.length} pages provided).`,
    `  - The 30-word cap is HARD — a page over 30 words fails editorial review and comes back for a rewrite. The pictures carry the rest.`,
    `  - A short run of tiny fragments ("Up, up, up!") counts as one breath — use one now and then for rhythm.`,
    `  - Vary length across pages: a big moment often lands hardest as a single short line.`,
  ].join('\n');

  // Language-specific instructions (appended when not English)
  const languageInstruction =
    input.language === 'ja'
      ? [
          `\n## Language — Japanese (日本語):`,
          `- Write ALL story text ("text" field) in **Japanese**.`,
          `- Use **hiragana** primarily, as this book is for young children (ages 3-5). **No kanji at all.** Katakana is fine for foreign words, and for the occasional sound word (keep to the one-per-page cap — never a page's main event).`,
          `- Maintain the same warm, playful, read-aloud quality described above, adapted for Japanese.`,
          `- Japanese sound words are one spice among many — at most one per page, never the page's main event (e.g. ざぶーん).`,
          `- Character names should remain as provided (do not transliterate to katakana unless they are clearly non-Japanese names).`,
          `- For unnamed people, use the warm hiragana relationship word a toddler would say (おばあちゃん、おじいちゃん、おかあさん、おとうさん、おねえちゃん、おにいちゃん、いもうと、おとうと) — NEVER invent a name. For unnamed pets use わんちゃん / ねこちゃん style words.`,
          `- **Length constraint (replaces the English rule above):** 1-2 sentences per page, **20-45 characters** (hard cap 48).`,
          `- The "illustrationNotes" field must remain in **English** (the illustration AI only understands English).`,
        ].join('\n')
      : '';

  const illustrationNotesInstructions = [
    `\n- For **each** page, also suggest "illustrationNotes" to dynamically enhance the image with fun effects:`,
    `  - Focus on **amplifying the specific action in the scene**:`,
    `    - Movement/Running: motion lines, speed streaks`,
    `    - Water/Splashing: water droplets, ripples`,
    `    - Eating/Food: steam wisps, crumbs flying`,
    `    - Jumping/Flying: arc trails`,
    `    - Surprise/Discovery: subtle glow`,
    `    - Hugging/Love: small floating hearts (2-3 max)`,
    `  - Match the effect to the page's BEAT: action effects (motion lines, arc trails, impact dust) belong on try/turn/climax pages; floating hearts, sparkles, and soft glows belong on quiet/breath/resolution pages ONLY — never over the climax.`,
    `  - **NEVER suggest words, letters, numbers, or sound-effect text in "illustrationNotes"** — the illustration is wordless; describe visual-only effects only.`,
    `  - Use sparkles ONLY for actual magic/wonder moments, not as a default effect.`,
    `  - Match the effect to the specific action - if a kid is eating, suggest food effects, not sparkles.`,
    `  - NEVER alter faces, poses, or introduce new characters.`,
    `  - **Specifically for illustrationNotes ONLY:** Use visual language (e.g., 'the boy in red', 'the girl with pigtails') instead of character names. The illustration AI doesn't know names.`,
    `  - If no dynamic effect fits, set "illustrationNotes" to null or empty.`,
    `\n- Effects must feel playful but natural, blending into the scene without overwhelming it.`,
    `\n- For **each** page, also set "moodCue" — 1-3 words for how this page's moment should FEEL in the picture ("hushed wonder", "giddy triumph", "cozy hush"). It steers lighting, atmosphere, and expression emphasis ONLY; it never changes pose, composition, or what the photo shows. Use null when the moment is genuinely neutral.`,
    `\n- Final Output:`,
    `\nReturn ONLY a valid JSON object with a "storyArc" object, a "beatSheet" array, a "suggestedTitle" string, AND a "pages" array${bridgeSection ? ', AND a "bridgePages" array (empty when no bridges are needed — the usual case)' : ''}. Plan the storyArc FIRST (desire, obstacle, throughline, tryAndOvercome, refrain, emotionalPeak, resolution), then the beatSheet (one beat per page), then write pages that DELIVER their beats.`,
    `Each page element must have "pageNumber" (number), "text" (string), "illustrationNotes" (string or null), and "moodCue" (string or null).`,
    `Example format: {"storyArc":{"desire":"...","obstacle":"...","throughline":"...","tryAndOvercome":"...","refrain":"...","emotionalPeak":"...","resolution":"..."},"beatSheet":[{"pageNumber":1,"role":"setup","goal":"...","handoff":"..."}],"suggestedTitle":"...","pages":[{"pageNumber":1,"text":"Sample text...","illustrationNotes":"Suggestion...","moodCue":"hushed wonder"}]}`,
  ].join('');

  parts.push({
    text: `${baseInstructions}${languageInstruction}\n${illustrationNotesInstructions}`,
  });

  return parts;
}

/**
 * X16 W1: perception assigns narrativeRole per photo at analysis time; a
 * parent reorder can leave the roles contradicting the current sequence
 * (reorder never re-runs perception). When the ordering is implausible as an
 * arc, the hints are dropped book-wide — the beat sheet plans unaided.
 */
export function arcRoleHintsUsable(roles: (string | null | undefined)[]): boolean {
  const present = roles
    .map((r, i) => ({ role: r ?? null, index: i }))
    .filter((e): e is { role: string; index: number } => e.role !== null);
  if (present.length === 0) return true;
  const first = present[0].role;
  const last = present[present.length - 1].role;
  if (first === 'closing' || first === 'peak') return false;
  if (last === 'opening') return false;
  const firstOpening = present.find((e) => e.role === 'opening')?.index ?? -1;
  const anyClosingBeforeOpening =
    firstOpening >= 0 && present.some((e) => e.role === 'closing' && e.index < firstOpening);
  return !anyClosingBeforeOpening;
}

// Export types for response parsing
export interface StoryPageResponse {
  pageNumber: number;
  text: string;
  illustrationNotes?: string | null;
  /** Which parent-supplied learning words this page's text contains. */
  learningWordsUsed?: string[];
  /**
   * STORY QUALITY V2 (photo path): how this page's moment should FEEL in the
   * picture (1-3 words) — lighting/atmosphere/expression only, never
   * composition. Consumed by the illustration mood channel
   * (STORY_ILLUS_MOOD_ENABLED); absent on avatar pages (scene.mood instead).
   */
  moodCue?: string | null;
}

export interface StoryArc {
  desire: string;
  /** The one thing in the way of the desire — the problem that makes it a story. */
  obstacle: string;
  /**
   * STORY QUALITY V2: the single connective spine — problem/goal plus the
   * recurring object or question planted in setup and paid off at the end.
   */
  throughline: string;
  /** How the child tries, wobbles, and tries again. Null when there is no obstacle to overcome. */
  tryAndOvercome: string | null;
  refrain: string;
  emotionalPeak: string;
  resolution: string;
}

/** STORY QUALITY V2: one structural beat per page, planned before prose. */
export type BeatRole =
  'setup' | 'complication' | 'try' | 'breath' | 'turn' | 'climax' | 'resolution';

export interface BeatSheetEntry {
  pageNumber: number;
  role: BeatRole;
  /** The one thing this page does for the throughline (one line). */
  goal: string;
  /** What leans into the next page. Null only on the final page. */
  handoff: string | null;
}

/**
 * Structured continuity record for a BRIDGE page — written by the story
 * model, validated in the worker, persisted on Page.bridgeScene, and read by
 * the illustration worker (which has no photo for this page).
 */
export interface BridgeScene {
  location: string;
  timeOfDay: string;
  action: string;
  /** characterIds from the roster (validated: subset, or the bridge is dropped). */
  charactersPresent: string[];
  outfitFrom: 'previous' | 'next';
  props: string[];
  /**
   * X16 W1: 1-3 words for how this moment should FEEL — the illustrator has no
   * photo for a bridge, so this is its only emotional steer. Drives the
   * renderer's mood directive and QC moodMismatch. Null when the moment is
   * neutral; absent on pre-X16 stored scenes (render code stays null-safe).
   */
  mood: string | null;
  /**
   * X16 W1: who + what owns the composition ("Emma reaching for the branch").
   * The bridge's only compositional steer. Null when no single focus; absent
   * on pre-X16 stored scenes.
   */
  focus: string | null;
}

export interface StoryBridgePageResponse {
  /** 1-based storyboard page this bridge follows; N = trailing wind-down. */
  afterPhotoPage: number;
  text: string;
  illustrationNotes: string | null;
  /** Which parent-supplied learning words this bridge text contains. */
  learningWordsUsed?: string[];
  scene: BridgeScene;
}

export interface StoryResponse {
  storyArc: StoryArc;
  /** STORY QUALITY V2: the per-page structural plan, generated before pages. */
  beatSheet: BeatSheetEntry[];
  suggestedTitle: string;
  pages: StoryPageResponse[];
  /** Present only when STORY_RESPONSE_SCHEMA_WITH_BRIDGES was requested. */
  bridgePages?: StoryBridgePageResponse[];
}

// ----------------------------------
// AVATAR STORIES (X6d) — no photos
// ----------------------------------
//
// AVATAR_STORY books have zero photos: the parent picked a cast of account
// avatars, a premise ("the spark"), and a page count. The model invents the
// whole adventure and, because the illustrator has no photo for ANY page,
// must emit a structured scene per page (the BridgeScene contract minus
// outfitFrom — there is no adjacent photo to copy outfits from; wardrobe
// comes from each avatar's rendition sheet).

/** Per-page scene for an avatar story — persisted on Page.bridgeScene. */
export interface AvatarPageScene {
  location: string;
  timeOfDay: string;
  action: string;
  /** characterIds from the cast roster (avatar_1, avatar_2, ...). */
  charactersPresent: string[];
  props: string[];
  /**
   * X13 Track L: the page's emotional beat (1-3 words, seeded from the
   * storyArc.emotionalPeak trajectory) — drives the renderer's mood directive
   * and the QC moodMismatch telemetry. Optional/nullable: older persisted
   * scenes and degraded parses carry no mood.
   */
  mood?: string | null;
  /**
   * X13 Track L: the single character+action the composition centers on
   * ("Kai reaching for the lantern") — drives the renderer's focus directive.
   * Optional/nullable for the same degrade-safety reason as `mood`.
   */
  focus?: string | null;
}

export interface AvatarStoryPageResponse extends StoryPageResponse {
  scene: AvatarPageScene;
}

export interface AvatarStoryResponse {
  storyArc: StoryArc;
  /** STORY QUALITY V2: the per-page structural plan, generated before pages. */
  beatSheet: BeatSheetEntry[];
  suggestedTitle: string;
  pages: AvatarStoryPageResponse[];
}

const AVATAR_PAGE_SCENE_SCHEMA = {
  type: 'object',
  description: 'Structured scene record — the illustrator has NO photo for any page of this book',
  properties: {
    location: {
      type: 'string',
      description: 'Where this moment happens — keep locations continuous page to page',
    },
    timeOfDay: { type: 'string', description: 'e.g. "morning", "golden afternoon"' },
    action: { type: 'string', description: 'What the characters are DOING in this moment' },
    charactersPresent: {
      type: 'array',
      items: { type: 'string' },
      description: 'characterIds from the cast roster — ONLY ids from the cast',
    },
    props: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete objects in the scene (keep recurring props consistent)',
    },
    mood: {
      type: ['string', 'null'],
      description:
        'The emotional beat of THIS page in 1-3 words ("gleeful", "hushed wonder"), drawn from the storyArc.emotionalPeak trajectory — how the moment FEELS, not what happens. Null only if genuinely neutral.',
    },
    focus: {
      type: ['string', 'null'],
      description:
        'The single character + action the picture is ABOUT ("Kai reaching for the lantern") — who owns the composition on this page. Null only when the page is a pure establishing shot with no focal character.',
    },
  },
  required: ['location', 'timeOfDay', 'action', 'charactersPresent', 'props', 'mood', 'focus'],
  additionalProperties: false,
} as const;

/**
 * Strict-mode response schema for AVATAR_STORY books: the photo contract plus
 * a REQUIRED structured scene on every page, and no bridgePages (every page
 * already renders photo-less).
 */
export const STORY_RESPONSE_SCHEMA_AVATAR = {
  type: 'object',
  properties: {
    storyArc: STORY_RESPONSE_SCHEMA.properties.storyArc,
    beatSheet: STORY_RESPONSE_SCHEMA.properties.beatSheet,
    suggestedTitle: STORY_RESPONSE_SCHEMA.properties.suggestedTitle,
    pages: {
      type: 'array',
      description: 'Story text, illustration notes, and scene for each page',
      items: {
        type: 'object',
        properties: {
          // No moodCue here — avatar pages carry the richer scene.mood instead.
          ...PAGE_ITEM_PROPERTIES,
          scene: AVATAR_PAGE_SCENE_SCHEMA,
        },
        required: [...PAGE_ITEM_REQUIRED, 'scene'],
        additionalProperties: false,
      },
    },
  },
  required: ['storyArc', 'beatSheet', 'suggestedTitle', 'pages'],
  additionalProperties: false,
} as const;

export const AVATAR_STORY_SYSTEM_PROMPT = `You are an expert children's picture-book author for children ages 3-5. Parents read your stories aloud. Every book is a real little adventure — a beginning, a problem, and a satisfying end.

THIS BOOK IS DIFFERENT — there are no photos. The parent picked a cast of characters (real people, pets, and beloved toys from the child's life, drawn as storybook characters) and a story spark. You invent the whole adventure:
- The cast are REAL to this child — their child, their grandma, their dog. Treat them with warmth and truth to their roles, then take them somewhere wonderful.
- You plan every moment: what happens on each page, where it happens, who is there. Make the page-turn feel inevitable.
- Every page must advance the STORY — an emotional journey with desire, tension, and resolution.

Your north star: Would a parent want to re-read this 100 times? That requires emotional truth, rhythm, and a refrain worth repeating.`;

export interface AvatarStoryCastMember {
  /** Per-book roster id (avatar_1, avatar_2, ...) — scenes reference these. */
  characterId: string;
  name: string;
  /** main_child | child | grown-up | pet | companion_object */
  role: string;
  /** One-line appearance note (from the avatar's identity), for illustrationNotes wording. */
  description?: string;
}

export interface AvatarStoryGenerationInput {
  bookTitle: string;
  pageCount: number;
  /** The parent/child-picked spark — the premise the story must deliver. */
  premise: string;
  cast: AvatarStoryCastMember[];
  childName?: string;
  tone?: string;
  language?: string; // "en" | "ja", defaults to "en"
  suggestTitle?: boolean;
  qcFeedback?: string;
  /** Parent-supplied words the child is learning (max 4). Woven 3-4x each. */
  learningWords?: string[];
  /**
   * X13 Track T (TOYS_COME_ALIVE_ENABLED, default absent/false = today's
   * prompt byte-identical): see StoryGenerationInput.toysComeAlive. Flips a
   * companion_object cast member from grounded-object to living-companion.
   */
  toysComeAlive?: boolean;
}

/**
 * Prompt for AVATAR_STORY books. Text-only (no image parts): the premise
 * replaces the photo storyboard, the cast enters page-less, and the model
 * plans the page sequence itself — every page must carry a structured scene.
 */
export function createAvatarStoryPrompt(input: AvatarStoryGenerationInput): StoryPromptPart[] {
  const parts: StoryPromptPart[] = [];

  parts.push({
    text: `# Configuration\nBook Title: ${
      input.bookTitle || 'My Special Story'
    }\nPage Count: ${input.pageCount}\nReturn EXACTLY ${input.pageCount} pages, numbered 1 to ${input.pageCount}. Page 1 is also the book's cover moment — open with an inviting, iconic scene that promises the adventure.`,
  });

  // ---------- THE CAST ----------
  const castLines: string[] = [`# The Cast (picked by the parent — these are the ONLY characters)`];
  for (const c of input.cast) {
    const isPet = c.role === 'pet';
    const isObject = c.role === 'companion_object';
    const isStar = c.role === 'main_child';
    const flavor = isStar
      ? ` — the STAR. The story is theirs: their desire, their peak, their landing. Use their name directly in the story text.`
      : isPet
        ? ` — the family's animal companion. Keep them a real animal (sounds, wags, nuzzles), never a talking character.`
        : isObject
          ? input.toysComeAlive
            ? ` — the child's beloved toy, brought to life for this adventure: it moves, plays, reacts, and has feelings of its own, adventuring side by side; it may even speak when the story wants it to. A true companion in the action, yet it stays recognizably itself — the same beloved toy, never turned into a person. Let it share the emotional beats.`
            : ` — the child's beloved object. It can be hugged, carried, dropped, lost and found, tucked in; it never walks, talks, or acts on its own. Let it anchor emotional beats.`
          : ` — give them a real supporting role: involve them in at least one emotional beat (a shared laugh, a steadying hand, a discovery together), and if they are present near the end, include them in the landing.`;
    const desc = c.description ? ` Appearance: ${c.description}.` : '';
    castLines.push(
      `- characterId "${c.characterId}" = ${c.name} (${c.role.replace(/_/g, ' ')})${flavor}${desc}`,
    );
  }
  castLines.push(
    `- Not everyone needs to be on every page — but everyone the parent picked should MATTER to the story.`,
    `- NEVER invent a new person, pet, or named place. Use ONLY the names given above; the parent chose them.`,
    `- For relationships, use the warm word a toddler would say ("Grandma", "Daddy", "Auntie") only if it matches the listed role — never invent a proper name.`,
    `- At most TWO named characters ACT in any page's text. Others may appear in the scene — but never roll-call the cast ("A does X, B does Y, and C does Z" is the pattern to avoid).`,
  );
  parts.push({ text: castLines.join('\n') });

  // ---------- THE SPARK ----------
  parts.push({
    text: [
      `# The Spark (picked by the parent${input.childName ? ` and ${input.childName}` : ''} — this is the promise of the book)`,
      `- "${input.premise}"`,
      `- The story must DELIVER this spark: it sets the desire, shapes the peak, and colors the landing — not a one-line mention. This is a made-up adventure starring real people; invent freely inside the spark's promise.`,
    ].join('\n'),
  });

  // ---------- SCENES ----------
  const sceneInstructions = [
    `# Scenes (REQUIRED for every page — the illustrator has NO photos):`,
    `- For EACH page fill "scene": location, timeOfDay, action, charactersPresent, props, mood, focus.`,
    `- "charactersPresent" lists the characterIds (from The Cast above) actually visible on that page. The star should appear on most pages.`,
    `- "scene.action" must name WHO does WHAT, matching the focal beat of this page's text — and every character the page text names as present or acting on this page MUST appear in "charactersPresent" (the illustrator sees ONLY the scene, never the text — a name left out of charactersPresent vanishes from the picture).`,
    `- When the page text makes it unambiguous WHO holds a prop, phrase that prop with its holder inside the props string — e.g. "lantern held by Kai". When the holder is not clear, use a plain prop name.`,
    `- "scene.mood" is the emotional beat of THIS page in 1-3 words ("gleeful", "hushed wonder", "brave"). Track the storyArc's emotionalPeak trajectory across the book — the mood should build toward the peak and settle after it, so the illustrator can light and pose the moment to FEEL right, not just look right.`,
    `- "scene.focus" is the single character + action the picture is ABOUT ("Kai reaching for the lantern") — the one figure whose moment the composition centers on. It names who OWNS the page, drawn from charactersPresent; the rest support them.`,
    `- Keep the world CONTINUOUS: locations flow into each other (garden → gate → lane), time of day moves forward, recurring props stay consistent.`,
    `- Keep scenes concrete and drawable: one clear action per page, simple settings a toddler recognizes.`,
  ].join('\n');

  const baseInstructions = [
    `# Instructions & Guiding Principles:`,
    `- Imagine a parent curled up with their child, reading aloud. Every sentence should feel warm, playful, and alive in a parent's voice.`,
    `- Write from the **toddler's perspective** — what they see, feel, touch, hear, and wonder about. Ground every moment in their sensory experience.`,
    ``,
    sceneInstructions,
    ``,
    `## Narrative Architecture — ONE problem, escalating tries, an earned payoff:`,
    `- **The child is the DOER**: give them one clear goal, one thing in the way, and let them TRY, wobble, and try again before it works. The child acts ON the world — not just moving through it. That trying is what makes a story fun instead of a tour.`,
    `- **SITUATION** (first ~20% of pages): establish the child's world AND the one desire or problem this book is about. Plant the throughline here — the recurring object, question, or quest the whole story hangs on (name it in "storyArc.throughline"). If the title names a thing, it appears in this stretch, never sprung near the end.`,
    `- **COMPLICATION & TRIES** (the middle): the SAME problem pushes back, and each try ESCALATES — bigger, closer, braver. NEVER stage a new, unrelated set-piece on each page; obstacle after unconnected obstacle is a tour, not a story. This is where the refrain repeats and evolves.`,
    `- **TURN** (about 3/4 through): the hardest moment — the try that almost fails. Let it wobble hardest here.`,
    `- **RESOLUTION** (final 1-2 pages): the child's OWN action pays off the throughline, and the feeling lands with a warm exhale — the last page a parent lingers on. Only sweet or sleepy stories drift into a bedtime hush; an adventure earns a satisfied, wide-awake glow. Read the story's own energy to choose which — never ask the parent. The climax's payoff must be COMPLETE before the final page begins — but the climax page itself must not end on the completed payoff; its last clause opens the door to the landing.`,
    `- NEVER end with "What a wonderful day" or similar summary statements. Let the accumulated feeling speak for itself.`,
    ``,
    `## BEAT SHEET (required — plan it BEFORE any page text, in "beatSheet"):`,
    `- Assign every page exactly ONE beat: "setup", "complication", "try", "breath", "turn", "climax", or "resolution".`,
    `- You invent the page sequence: setup in the first ~20% of pages, escalating tries through the middle, the turn about 3/4 through, resolution in the final 1-2 pages.`,
    `- "goal": the single job that page does for the throughline (one line). "handoff": what leans into the next page (null ONLY on the final page).`,
    `- Every "try" beat escalates the SAME problem. If a beat's goal could belong to a different book, it is wrong.`,
    `- Then write each page's text AND scene to DELIVER its beat — a page that ignores its declared beat fails editorial review.`,
    ``,
    `## PAGE-TO-PAGE FLOW (critical):`,
    `- **Connective device**: choose ONE thread and pull every page through it: a wondering question the child carries, a tiny quest, something the child is collecting or counting, or the refrain itself acting as a heartbeat. Never let pages sit side by side unconnected.`,
    `- **Hand-off rule**: Every page except the last must END with something that leans into the next page — a shadow slipping across the floor, a glance toward something new, a question, an "and then...?" energy (a sound getting closer can work too, but don't lean on it). The listener should NEED the page turn. The CLIMAX page especially must not end on the completed payoff sentence.`,
    `- **Callbacks**: In the RESOLUTION, echo one concrete detail from the SITUATION pages (an object, a gesture, the refrain in its softest form). This is what makes a story feel whole instead of a list of moments.`,
    ``,
    `## Recurring Refrain (REQUIRED):`,
    `- Create a short phrase (4-8 words) that echoes through the story at least 3 times.`,
    `- Vary it slightly each time — change one word, add emphasis, or whisper it the last time.`,
    `- At least TWO echoes must be standalone narrator lines — their own sentence, OUTSIDE any quotation marks. At most ONE echo may live inside a character's dialogue. The parent needs a chantable line, not contorted speech.`,
    `- Great refrains feel like a heartbeat — reach for an action, a feeling, or the child's name: "One more step, brave Kai!" → "Two more steps, brave Kai!" → "You did it, brave Kai!". At most one sound-based refrain per book, and only if it truly earns its place.`,
    `- Report this phrase in the "storyArc.refrain" field.`,
    ``,
    ...(input.learningWords?.length
      ? [
          `## LEARNING WORDS (the parent is teaching these — weave, never force):`,
          `- The parent says ${input.childName || 'the child'} is learning these words right now: ${input.learningWords
            .slice(0, 4)
            .map((w) => `"${w}"`)
            .join(', ')}.`,
          `- Weave EACH word into the story 3-4 times, naturally — vary the sentence frame each time, exactly like the refrain.`,
          `- Place at least one occurrence of each word at the END of a sentence in a predictable slot, so the reading parent can pause and let the child say it.`,
          `- Prefer sentences that also contain ${input.childName ? `"${input.childName}"` : "the child's name"} — words land best next to the child's own name.`,
          `- At most ONE learning word per page. Never stack two on the same page, never repeat a word twice in one sentence, never bend the story to fit a word — a word that doesn't fit this story is better used 3 times than forced 4.`,
          `- For each page, report exactly which learning words its text contains in "learningWordsUsed" (verbatim strings from the list above; empty array when none).`,
          ``,
        ]
      : []),
    `## Voice & Rhythm (critical for read-aloud quality):`,
    `- **Vary sentence structure**: mix short punchy fragments ("Up, up, up!") with slightly longer flowing sentences. Avoid monotonous Subject-Verb-Object patterns.`,
    `- **Sound words are one spice among many** — reach for a vivid verb or an image first. Use AT MOST one sound word per page, and never as the page's main event.`,
    `- Sentences should have a **musical quality** when read aloud — rhythm matters more than vocabulary.`,
    `- Use concrete nouns and action verbs. No abstractions. One idea per sentence.`,
    ``,
    `## Dialogic Moments:`,
    `- Include 2-3 questions across the whole book that invite the listening child to participate: "Can you see...?", "What do you think happens next?", "What do YOU think is behind the door?"`,
    `- Place these naturally — never more than one per page, and never on the final page.`,
    ``,
    `## Emotional Texture:`,
    `- Capture the **small moments** that make a toddler's day magical — the wonder of a new texture, the thrill of a puddle, the safety of a parent's hand.`,
    `- Show emotions through **actions and senses**, not labels: instead of "Kai was happy", write "Kai's eyes go wide. He squeezes Mama's hand tight."`,
    `- Include **gentle humor** that comes from the SITUATION, not sound effects — a silly predicament, a small joke that repeats and grows each time, or a character's surprised reaction.`,
    ``,
    `## Title:`,
    input.suggestTitle
      ? `- The parent has NOT chosen a title yet — your "suggestedTitle" WILL become the book's title. Make it short (2-6 words), warm, and specific to this story${input.language === 'ja' ? ', written in Japanese (hiragana/katakana, no kanji)' : ''}. Avoid generic titles like "A Special Day".`
      : `- The parent chose the title above. Still provide a "suggestedTitle" as an alternative, but the story should honor the existing title.`,
    ``,
    ...(input.qcFeedback
      ? [
          `## CRITICAL CORRECTIONS (from editorial review of your previous draft):`,
          `- A previous draft of this story failed editorial review. You MUST address every point below in this rewrite:`,
          input.qcFeedback
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n'),
          ``,
        ]
      : []),
    ...(input.tone
      ? [
          `## Story Mood (picked by the parent):`,
          `- The parent asked for a **"${input.tone}"** telling. Let it steer word choice, pacing, and the energy of the peak. The mood is a promise to the parent, not a garnish.`,
          ``,
        ]
      : []),
    `## Length:`,
    `- **1-2 sentences per page, 15-30 words** (for the ${input.pageCount} pages).`,
    `  - The 30-word cap is HARD — a page over 30 words fails editorial review and comes back for a rewrite. The pictures carry the rest.`,
    `  - A short run of tiny fragments ("Up, up, up!") counts as one breath — use one now and then for rhythm.`,
    `  - Vary length across pages: a big moment often lands hardest as a single short line.`,
  ].join('\n');

  const languageInstruction =
    input.language === 'ja'
      ? [
          `\n## Language — Japanese (日本語):`,
          `- Write ALL story text ("text" field) in **Japanese**.`,
          `- Use **hiragana** primarily, as this book is for young children (ages 3-5). **No kanji at all.** Katakana is fine for foreign words, and for the occasional sound word (keep to the one-per-page cap — never a page's main event).`,
          `- Maintain the same warm, playful, read-aloud quality described above, adapted for Japanese.`,
          `- Japanese sound words are one spice among many — at most one per page, never the page's main event (e.g. ざぶーん).`,
          `- Character names should remain as provided (do not transliterate to katakana unless they are clearly non-Japanese names).`,
          `- For unnamed people, use the warm hiragana relationship word a toddler would say (おばあちゃん、おじいちゃん、おかあさん、おとうさん、おねえちゃん、おにいちゃん、いもうと、おとうと) — NEVER invent a name. For unnamed pets use わんちゃん / ねこちゃん style words.`,
          `- **Length constraint (replaces the English rule above):** 1-2 sentences per page, **20-45 characters** (hard cap 48).`,
          `- The "illustrationNotes" and "scene" fields must remain in **English** (the illustration AI only understands English).`,
        ].join('\n')
      : '';

  const illustrationNotesInstructions = [
    `\n- For **each** page, also suggest "illustrationNotes" to dynamically enhance the image with fun effects:`,
    `  - Focus on **amplifying the specific action in the scene**:`,
    `    - Movement/Running: motion lines, speed streaks`,
    `    - Water/Splashing: water droplets, ripples`,
    `    - Eating/Food: steam wisps, crumbs flying`,
    `    - Jumping/Flying: arc trails`,
    `    - Surprise/Discovery: subtle glow`,
    `    - Hugging/Love: small floating hearts (2-3 max)`,
    `  - **NEVER suggest words, letters, numbers, or sound-effect text in "illustrationNotes"** — the illustration is wordless; describe visual-only effects only.`,
    `  - Use sparkles ONLY for actual magic/wonder moments, not as a default effect.`,
    `  - Match the effect to the specific action - if a kid is eating, suggest food effects, not sparkles.`,
    `  - **Specifically for illustrationNotes ONLY:** Use visual language (e.g., 'the boy in red', 'the girl with pigtails') instead of character names. The illustration AI doesn't know names.`,
    `  - If no dynamic effect fits, set "illustrationNotes" to null or empty.`,
    `\n- Effects must feel playful but natural, blending into the scene without overwhelming it.`,
    `\n- Final Output:`,
    `\nReturn ONLY a valid JSON object with a "storyArc" object, a "beatSheet" array, a "suggestedTitle" string, AND a "pages" array. Plan the storyArc FIRST (desire, obstacle, throughline, tryAndOvercome, refrain, emotionalPeak, resolution), then the beatSheet (one beat per page), then write pages that DELIVER their beats.`,
    `Each page element must have "pageNumber" (number), "text" (string), "illustrationNotes" (string or null), "learningWordsUsed" (array), and "scene" (object).`,
  ].join('');

  parts.push({
    text: `${baseInstructions}${languageInstruction}\n${illustrationNotesInstructions}`,
  });

  return parts;
}
