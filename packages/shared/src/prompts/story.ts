// ----------------------------------
// IMPORTS & TYPES
// ----------------------------------

// Prompt part types for multi-modal story generation
export interface TextPart { text: string }
export interface ImagePlaceholder {
  type: 'image_placeholder';
  imageUrl: string;
  pageNumber: number;
}
export type StoryPromptPart = TextPart | ImagePlaceholder;

// JSON Schema for OpenAI structured output (strict mode)
// Array-based format: { pages: [{ pageNumber, text, illustrationNotes }, ...] }
// NOTE: this legacy shape stays byte-identical — bridge pages are requested
// via STORY_RESPONSE_SCHEMA_WITH_BRIDGES only when BRIDGE_PAGES_ENABLED.
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
        refrain: {
          type: 'string',
          description: 'A 4-8 word phrase that will recur 3+ times with variation throughout the story',
        },
        emotionalPeak: {
          type: 'string',
          description: 'The moment of biggest feeling — wonder, triumph, laughter, or warmth (1 sentence)',
        },
        resolution: {
          type: 'string',
          description: 'How does the story land? What feeling does the child carry into sleep? (1 sentence)',
        },
      },
      required: ['desire', 'refrain', 'emotionalPeak', 'resolution'],
      additionalProperties: false,
    },
    suggestedTitle: {
      type: 'string',
      description: 'A short, evocative book title (2-6 words) in the story language. Suggest one even if a title was provided.',
    },
    pages: {
      type: 'array',
      description: 'Story text and illustration notes for each page',
      items: {
        type: 'object',
        properties: {
          pageNumber: {
            type: 'number',
            description: 'The 1-based page number'
          },
          text: {
            type: 'string',
            description: 'The story text for this page (2-4 sentences, max 50 words)'
          },
          illustrationNotes: {
            type: ['string', 'null'],
            description: 'Visual effects suggestion for the illustration, or null if none'
          }
        },
        required: ['pageNumber', 'text', 'illustrationNotes'],
        additionalProperties: false,
      }
    }
  },
  required: ['storyArc', 'suggestedTitle', 'pages'],
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
            description: 'Where this moment happens — plausibly between the adjacent photos’ settings',
          },
          timeOfDay: { type: 'string', description: 'e.g. "morning", "golden afternoon"' },
          action: { type: 'string', description: 'What the characters are DOING in this new moment' },
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
        },
        required: ['location', 'timeOfDay', 'action', 'charactersPresent', 'outfitFrom', 'props'],
        additionalProperties: false,
      },
    },
    required: ['afterPhotoPage', 'text', 'illustrationNotes', 'scene'],
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
  charactersInPhotos?: {
    /** Stable roster id — bridge pages reference characters by this id. */
    characterId?: string;
    name: string;
    role: string;
    appearsOnPages: number[]; // empty = present in the photos, but exact pages unknown (page-less prompt variant)
    namedVia?: 'chip' | 'childName' | 'fallback'; // provenance of `name`; chip/childName = parent-confirmed, must appear verbatim
  }[]; // From the perception pass — who actually appears where
  /**
   * BRIDGE_PAGES_ENABLED: maximum bridge pages the model may propose
   * (code-enforced again in the worker). 0/undefined = no bridge section in
   * the prompt and no bridgePages in the response schema — the legacy prompt
   * stays byte-identical.
   */
  bridgeCap?: number;
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

export const STORY_GENERATION_SYSTEM_PROMPT = `You are an expert children's picture-book author for toddlers (ages 2-4). Parents read your stories aloud at bedtime.

CRITICAL MINDSET — You are a STORYTELLER, not a photo captioner:
- Photos are INSPIRATION, not subjects. A photo of a child at the park should spark a narrative moment (wonder, mischief, discovery) — NOT a description of "a child standing in the park."
- Every page must advance the STORY — an emotional journey with desire, tension, and resolution.
- If you find yourself describing what's visible in a photo, STOP and rewrite from the child's inner experience.

Your north star: Would a parent want to re-read this 100 times? That requires emotional truth, rhythm, and a refrain worth repeating.`;

// ----------------------------------
// STORY GENERATION PROMPT
// ----------------------------------

export function createStoryGenerationPrompt(
  input: StoryGenerationInput
): StoryPromptPart[] {
  const parts: StoryPromptPart[] = [];

  // ---------- CONFIG ----------
  parts.push({
    text: `# Configuration\nBook Title: ${
      input.bookTitle || 'My Special Story'
    }\nPage Count: ${input.storyPages.length}`,
  });

  // ---------- STORYBOARD (IMAGES) ----------
  parts.push({ text: '# Storyboard Sequence' });

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
      parts.push({
        text: `WHAT'S HERE (raw notes, NOT the story): ${page.analysis.setting}; ${page.analysis.action}; ${page.analysis.emotion}.${signals} ARC ROLE: ${page.analysis.narrativeRole}.`,
      });
    }
  });
  parts.push({ text: '--- End Storyboard ---' });

  // ---------- INSTRUCTIONS ----------
  // Build character instruction dynamically based on provided names
  let characterInstruction: string;
  if (input.childName) {
    characterInstruction = `  - The main character is named "${input.childName}". Use this name directly in the story text.`;
    if (input.additionalCharacters && input.additionalCharacters.length > 0) {
      const charList = input.additionalCharacters
        .map(c => `"${c.name}" (${c.relationship})`)
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
    const supporting = input.charactersInPhotos.filter(c => c.role !== 'main_child');
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
          ? ` It is the child's beloved object — it can be hugged, carried, dropped, lost and found, tucked in; it never walks, talks, or acts on its own. Let it anchor emotional beats (comfort at the quiet moment, joining the landing).`
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
      if (supporting.some(c => c.appearsOnPages.length === 0)) {
        characterInstruction += ` For characters whose exact pages are unknown, include them only on pages where you can actually see them in the storyboard images.`;
      }
    }
  }

  // Name discipline: names come from the parent, never from the model.
  characterInstruction += [
    ``,
    `  - NEVER invent a proper name for anyone. Use ONLY the names given above.`,
    `  - For unnamed people, use the warm relationship word a toddler would say — "Grandma", "Grandpa", "Daddy", "Mummy", "Auntie", "the little sister" — based on their listed role. If the relationship is unclear, use a neutral warm term like "a friend".`,
    `  - For unnamed pets, use simple animal words ("the dog", "the cat"). For unnamed beloved objects, use simple object words ("her bunny", "the blanket"). Never name a pet or object the parent didn't name. A pet or object the parent DID name is a character too — use that name.`,
  ].join('\n');

  // BRIDGE PAGES (BRIDGE_PAGES_ENABLED): rendered only when the worker set a
  // positive cap AND the roster carries characterIds (identity-less books
  // must never get bridges — there is nothing to ground them to).
  const bridgeRoster = (input.charactersInPhotos ?? []).filter(c => c.characterId);
  const bridgeSection =
    input.bridgeCap && input.bridgeCap > 0 && bridgeRoster.length > 0
      ? [
          ``,
          `## BRIDGE PAGES (optional — most books need ZERO):`,
          `- You may add up to ${input.bridgeCap} bridge page(s) — an extra page WITHOUT a photo — but ONLY where a narrative beat is genuinely missing between two adjacent photos (a journey, an approach, an anticipation) or as a wind-down AFTER the last photo. A bridge exists to make the page-turn feel inevitable, never to pad. Report them in the "bridgePages" array; return an empty array when none are needed (the usual case).`,
          `- At most ONE bridge per gap, and never before the first photo. "afterPhotoPage" is the storyboard page the bridge follows (${input.storyPages.length} = after the last photo).`,
          `- GROUNDING (non-negotiable): a bridge may show ONLY people and pets from this roster, referenced by characterId in "scene.charactersPresent":`,
          ...bridgeRoster.map(
            c => `    - characterId "${c.characterId}" = ${c.name} (${c.role.replace(/_/g, ' ')})`,
          ),
          `- Never invent a person, a pet, or a named place. The setting must sit plausibly BETWEEN the adjacent photos' settings (use their WHAT'S HERE notes); the action must grow out of what the adjacent photos actually show. Set "scene.outfitFrom" to whichever adjacent photo the outfits should copy.`,
          `- Bridge text follows every rule in this prompt (refrain, hand-off, length limits) and must read as part of the same continuous story.`,
        ].join('\n')
      : '';

  const baseInstructions = [
    `# Instructions & Guiding Principles:`,
    `- Imagine a parent curled up with their toddler at bedtime, reading aloud. Every sentence should feel warm, playful, and alive in a parent's voice.`,
    `- Write from the **toddler's perspective** — what they see, feel, touch, hear, and wonder about. Ground every moment in their sensory experience.`,
    ``,
    `## ANTI-CAPTION RULE (critical):`,
    `- NEVER describe what's literally visible in the photo like a caption. Instead, narrate what the child FEELS, IMAGINES, or DISCOVERS in that moment.`,
    `- BAD: "Kai is at the beach. He sees the waves." (this is a caption)`,
    `- GOOD: "The waves whisper a secret — come closer, come closer! Kai wiggles his toes in the sand." (this is a story)`,
    `- Each page must contain at least one element that goes BEYOND the photo: an internal feeling, a question, a sensory detail, or an imaginative leap.`,
    ``,
    `## Narrative Architecture (OPENING → BUILDING → LANDING):`,
    `- **OPENING** (first ~20% of pages): Establish the child's world AND a small desire or question. What do they want, wonder about, or set out to do? Hook the listener.`,
    `- **BUILDING** (middle ~60%): The desire meets the world. Each page should ESCALATE — new discoveries, small obstacles, mounting excitement or tenderness. This is where the refrain repeats and evolves.`,
    `- **LANDING** (final ~20%): The emotional peak resolves into warmth and safety. The last page should feel like a soft exhale — a sentence a parent lingers on before closing the book.`,
    `- NEVER end with "What a wonderful day" or similar summary statements. Let the accumulated feeling speak for itself.`,
    `- Where pages carry an ARC ROLE note, use it: "opening" pages plant the desire, "rising" pages escalate, a "peak" page carries the emotional high point, "quiet" pages are a breath of tenderness, "closing" pages land the story. The roles are suggestions from the photos — honor their shape even while you interpret freely.`,
    ``,
    `## PAGE-TO-PAGE FLOW (critical — photos alone rarely tell a story):`,
    `- **Connective device**: If the photos read as a montage of separate moments rather than one continuous event, choose ONE thread and pull every page through it: a wondering question the child carries ("will the waves say hello back?"), a tiny quest, something the child is collecting or counting, or the refrain itself acting as a heartbeat. Never let pages sit side by side unconnected.`,
    `- **Hand-off rule**: Every page except the last must END with something that leans into the next page — a sound getting closer, a glance toward something new, a question, a "and then...?" energy. The listener should NEED the page turn.`,
    `- **Callbacks**: In the LANDING, echo one concrete detail from the OPENING (an object, a sound, the refrain in its softest form). This is what makes a story feel whole instead of a list of moments.`,
    ...(bridgeSection ? [bridgeSection] : []),
    ``,
    `## Recurring Refrain (REQUIRED):`,
    `- Create a short phrase (4-8 words) that echoes through the story at least 3 times.`,
    `- Vary it slightly each time — change one word, add emphasis, or whisper it the last time.`,
    `- Great refrains feel like a heartbeat: "Splish, splash, one more splash!" → "Splish, splash, the biggest splash!" → "Splish... splash... goodnight, little splash."`,
    `- Report this phrase in the "storyArc.refrain" field.`,
    ``,
    `## Voice & Rhythm (critical for read-aloud quality):`,
    `- **Vary sentence structure**: mix short punchy fragments ("Splish!") with slightly longer flowing sentences. Avoid monotonous Subject-Verb-Object patterns.`,
    `- **Onomatopoeia and sound words** should feel organic to the scene — rumble, swoosh, crunch, pitter-pat — not forced.`,
    `- Sentences should have a **musical quality** when read aloud — rhythm matters more than vocabulary.`,
    `- Use concrete nouns and action verbs. No abstractions. One idea per sentence.`,
    ``,
    `## Dialogic Moments:`,
    `- Include 2-3 questions across the whole book that invite the listening child to participate: "Can you see...?", "What do you think happens next?", "How many splashes was that?"`,
    `- Place these naturally — never more than one per page, and never on the final page.`,
    ``,
    `## Emotional Texture:`,
    `- Capture the **small moments** that make a toddler's day magical — the wonder of a new texture, the thrill of a puddle, the safety of a parent's hand.`,
    `- Show emotions through **actions and senses**, not labels: instead of "Kai was happy", write "Kai's eyes go wide. He squeezes Mama's hand tight."`,
    `- Include **gentle humor** — mild mischief, silly surprises, funny sounds.`,
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
    ...(input.qcFeedback ? [
      `## CRITICAL CORRECTIONS (from editorial review of your previous draft):`,
      `- A previous draft of this story failed editorial review. You MUST address every point below in this rewrite:`,
      input.qcFeedback.split('\n').map(line => `  ${line}`).join('\n'),
      ``,
    ] : []),
    ...(input.tone ? [
      `## Story Mood (picked by the parent):`,
      `- The parent asked for a **"${input.tone}"** telling. Let it steer word choice, pacing, and the energy of the peak. The mood is a promise to the parent, not a garnish.`,
      ``,
    ] : []),
    // Exactly ONE experience-context block reaches the prompt: the confirmed
    // eventSummary supersedes the legacy free-text theme when present.
    ...(input.eventSummary ? [
      `## What actually happened (confirmed by the parent — this is the heart of the story):`,
      `- "${input.eventSummary}"`,
      ...(input.confirmedFacts?.length
        ? input.confirmedFacts.map(f => `- Parent confirmed: ${f}`)
        : []),
      `- The story must feel TRUE to this. It should inform the desire, the peak, and the landing — not appear as a one-line mention.`,
      ``,
    ] : input.theme ? [
      `## Story Context:`,
      `- The parent described this story as: **"${input.theme}"**. Weave this context into the narrative — it should inform the story arc, not just be mentioned once.`,
      ``,
    ] : []),
    `## Length:`,
    `- **2-4 sentences per page, maximum 50 words** (for the ${input.storyPages.length} pages provided).`,
    `  - This 50 word limit is STRICT — text is displayed on its own page but must stay concise for toddler attention spans.`,
    `  - Vary length across pages for rhythm: some pages deserve a single punchy line, others need a beat more.`
  ].join('\n');

  // Language-specific instructions (appended when not English)
  const languageInstruction = input.language === 'ja'
    ? [
        `\n## Language — Japanese (日本語):`,
        `- Write ALL story text ("text" field) in **Japanese**.`,
        `- Use **hiragana** primarily, as this book is for toddlers (ages 2-4). **No kanji at all.** Katakana is OK for onomatopoeia and foreign words.`,
        `- Maintain the same warm, playful, read-aloud quality described above, adapted for Japanese.`,
        `- Use Japanese onomatopoeia naturally (ざぶーん, どきどき, ぴょんぴょん, きらきら, etc.).`,
        `- Character names should remain as provided (do not transliterate to katakana unless they are clearly non-Japanese names).`,
        `- For unnamed people, use the warm hiragana relationship word a toddler would say (おばあちゃん、おじいちゃん、おかあさん、おとうさん、おねえちゃん、おにいちゃん、いもうと、おとうと) — NEVER invent a name. For unnamed pets use わんちゃん / ねこちゃん style words.`,
        `- **Length constraint (replaces the English rule above):** 2-4 sentences per page, **maximum 80 characters** per page.`,
        `- The "illustrationNotes" field must remain in **English** (the illustration AI only understands English).`,
      ].join('\n')
    : '';

  const illustrationNotesInstructions = [
    `\n- For **each** page, also suggest "illustrationNotes" to dynamically enhance the image with fun effects:`,
    `  - Focus on **amplifying the specific action in the scene**:`,
    `    - Movement/Running: motion lines, speed streaks, "ZOOM!", "WHOOSH!"`,
    `    - Water/Splashing: water droplets, ripples, "SPLASH!", "SPLISH!"`,
    `    - Eating/Food: "YUM!", "MUNCH!", "CHOMP!", steam wisps, crumbs flying`,
    `    - Jumping/Flying: arc trails, "BOING!", "WHEEE!"`,
    `    - Surprise/Discovery: subtle glow, "WOW!", "OOOOH!"`,
    `    - Hugging/Love: small floating hearts (2-3 max)`,
    `  - Use sparkles ONLY for actual magic/wonder moments, not as a default effect.`,
    `  - Match the effect to the specific action - if a kid is eating, suggest food effects, not sparkles.`,
    `  - NEVER alter faces, poses, or introduce new characters.`,
    `  - **Specifically for illustrationNotes ONLY:** Use visual language (e.g., 'the boy in red', 'the girl with pigtails') instead of character names. The illustration AI doesn't know names.`,
    `  - If no dynamic effect fits, set "illustrationNotes" to null or empty.`,
    `\n- Effects must feel playful but natural, blending into the scene without overwhelming it.`,
    `\n- Final Output:`,
    `\nReturn ONLY a valid JSON object with a "storyArc" object, a "suggestedTitle" string, AND a "pages" array${bridgeSection ? ', AND a "bridgePages" array (empty when no bridges are needed — the usual case)' : ''}. Plan the storyArc FIRST (desire, refrain, emotionalPeak, resolution), then write pages that follow that arc.`,
    `Each page element must have "pageNumber" (number), "text" (string), and "illustrationNotes" (string or null).`,
    `Example format: {"storyArc":{"desire":"...","refrain":"...","emotionalPeak":"...","resolution":"..."},"suggestedTitle":"...","pages":[{"pageNumber":1,"text":"Sample text...","illustrationNotes":"Suggestion..."}]}`
  ].join('');

  parts.push({
    text: `${baseInstructions}${languageInstruction}\n${illustrationNotesInstructions}`,
  });

  return parts;
}

// Export types for response parsing
export interface StoryPageResponse {
  pageNumber: number;
  text: string;
  illustrationNotes?: string | null;
}

export interface StoryArc {
  desire: string;
  refrain: string;
  emotionalPeak: string;
  resolution: string;
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
}

export interface StoryBridgePageResponse {
  /** 1-based storyboard page this bridge follows; N = trailing wind-down. */
  afterPhotoPage: number;
  text: string;
  illustrationNotes: string | null;
  scene: BridgeScene;
}

export interface StoryResponse {
  storyArc: StoryArc;
  suggestedTitle: string;
  pages: StoryPageResponse[];
  /** Present only when STORY_RESPONSE_SCHEMA_WITH_BRIDGES was requested. */
  bridgePages?: StoryBridgePageResponse[];
}
