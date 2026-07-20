/**
 * User profile information
 */
export interface User {
  id: string;
  name: string;
  email: string;
  image?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Book project types
 */
export type BookStatus =
  'DRAFT' | 'GENERATING' | 'STORY_READY' | 'ILLUSTRATING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';

/** PHOTO_STORY = made from uploaded photos; AVATAR_STORY = invented adventure starring account avatars (X6d). */
export type BookType = 'PHOTO_STORY' | 'AVATAR_STORY';

/**
 * Additional character in the story (e.g., parent, sibling)
 */
export interface AdditionalCharacter {
  name: string;
  relationship: string;
}

export interface Book {
  id: string;
  userId: string;
  title: string;
  status: BookStatus;
  bookType?: BookType;
  pageLength: number;
  language: string;
  artStyle?: string | null;
  tone?: string | null;
  typography?: string | null;
  theme?: string | null;
  keyCharacters?: string | null;
  childName?: string | null;
  additionalCharacters?: string | null; // JSON string of AdditionalCharacter[]
  specialObjects?: string | null;
  excitementElement?: string | null;
  coverAssetId?: string | null;
  coverImageUrl?: string | null;
  characterIdentity?: CharacterIdentity | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Page model
 */
export type PageType = 'SINGLE' | 'SPREAD';

export interface Page {
  id: string;
  bookId: string;
  pageNumber: number;
  index: number;
  assetId?: string | null;
  originalImageUrl?: string | null;
  generatedImageUrl?: string | null;
  text?: string | null;
  textConfirmed?: boolean | null;
  illustrationNotes?: string | null;
  isTitlePage: boolean;
  pageType: PageType;
  moderationStatus?: string | null;
  moderationReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Asset model
 */
export interface Asset {
  id: string;
  userId: string;
  url: string;
  thumbnailUrl: string | null;
  publicId: string;
  fileType: string;
  size: number;
  createdAt: Date;
}

/**
 * API response type
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  /** Machine-readable error code (e.g. 'PRINT_ORDER_IN_FLIGHT') so clients can localize. */
  code?: string;
}

// Type for a Page including minimal Asset info needed for Storyboard AND Canvas
export type StoryboardPage = Page & {
  asset?: Pick<Asset, 'id' | 'url' | 'thumbnailUrl'> | null;
};

// Type for Book data including pages with updated StoryboardPage type
export type BookWithStoryboardPages = Book & {
  pages: StoryboardPage[];
};

/**
 * Queue job types
 */
export interface StoryGenerationJob {
  bookId: string;
  userId: string;
  assets: Asset[];
  bookDetails: Partial<Book>;
}

export interface IllustrationGenerationJob {
  bookId: string;
  userId: string;
  pageId: string;
  pageNumber: number;
  text: string | null;
  artStyle: string;
  bookTitle: string;
  isTitlePage: boolean;
  illustrationNotes?: string | null;
  originalImageUrl?: string | null;
  language?: string;
}

export interface BookFinalizeJob {
  bookId: string;
  userId: string;
  qcRound?: number;
  /** Set when the illustration run was scoped (single-page reillustrate / targeted retry): finalize skips the book-wide QC cascade. */
  scopedPageIds?: string[];
  /**
   * Snapshot of the reference stack the render children conditioned on,
   * carried through every QC round so a mid-flight "draw again" can never
   * swap the identity anchor between rounds. Absent on jobs from before this
   * field existed — finalize falls back to recomputing from the DB.
   */
  characterSheets?: CharacterSheetRef[];
}

/**
 * Print fulfillment job data - queued after Stripe payment completes.
 * Handles PDF generation, Dropbox upload, and Lulu submission.
 */
export interface PrintFulfillmentJob {
  printOrderId: string;
  userId: string;
  bookId: string;
}

/**
 * Character identity extraction job data.
 * Runs before illustrations to analyze all photos and extract canonical character descriptions.
 */
export interface CharacterExtractionJob {
  bookId: string;
  userId: string;
  artStyle: string;
  /**
   * X15 sheet pre-warm: enqueued alongside the story job so character-sheet
   * generation overlaps story generation. The worker only warms
   * Book.characterReferences (no status/phase/identity writes, no
   * illustration flow) and exits.
   */
  prepareOnly?: boolean;
  /**
   * X17 B4: set on the delayed grace-window job. The worker claims the book
   * (STORY_READY → ILLUSTRATING) at RUN time — the enqueuer deliberately did
   * not, so a cancelled/tweaked window leaves the book untouched at
   * STORY_READY.
   */
  claimBook?: boolean;
  pageIds?: string[];
  /**
   * Set by whole-book recovery/retry paths (reaper, book-level retry route):
   * pageIds still scope the render children (already-OK pages are not
   * repainted), but the finalize parent must run the book-wide QC pass and
   * palette normalization instead of treating the run as scoped.
   */
  recovery?: boolean;
}

/**
 * Extended illustration job with character identity and QC feedback.
 */
export interface IllustrationGenerationJobV2 extends IllustrationGenerationJob {
  characterIdentity?: CharacterIdentity | null;
  qcRound?: number;
  qcFeedback?: string | null;
  /**
   * Validated character-sheet references for the book's current art style,
   * snapshotted into the job like characterIdentity. Present only when
   * CHARACTER_SHEETS_ENABLED produced (or reused) sheets for this run.
   */
  characterSheets?: CharacterSheetRef[];
  /**
   * X15: when true this child re-renders ONLY the QC-failed cover as part of
   * a requeue flow (no page render, no page DB writes). pageId/pageNumber
   * carry the title page so diagnostics stay meaningful. Carries the cover
   * verdict whose suggestedPromptAdditions become the regen feedback.
   */
  coverRegen?: boolean;
  coverQcResult?: CoverQCResult | null;
}

/**
 * One validated character turnaround sheet, as carried in illustration job
 * data and resolved from Book.characterReferences for the current art style.
 */
export interface CharacterSheetRef {
  characterId: string;
  /** Character name for prompt role-labeling (falls back to characterId). */
  name: string | null;
  /** Cloudinary URL of the validated 2x2 turnaround sheet. */
  url: string;
}

/**
 * One entry of Book.characterReferences (Json array). Keyed by
 * (characterId, artStyle); entries are RETAINED across style flips so an
 * A→B→A style change never re-buys a sheet.
 */
export interface CharacterReferenceEntry {
  characterId: string;
  artStyle: string;
  url: string;
  /** ISO timestamp of the successful gpt-5-mini validation. */
  validatedAt: string;
}

/**
 * Canonical character identity extracted from all photos via Gemini vision.
 * Generated once per book, injected into every illustration prompt.
 */
export interface CharacterIdentity {
  characters: CharacterDescription[];
  sceneContext: string;
  /**
   * The artStyle the characters' styleTranslation prose was written for,
   * stamped at write time by the photo-analysis and character-extraction
   * workers. A mismatch with the book's current artStyle means the
   * translations are stale and need a text-only refresh — never a full
   * re-extraction. Absent on identities written before this stamp existed
   * (treat as mismatched).
   */
  extractedForStyle?: string;
}

/**
 * X17.2 P0d: normalized face rectangle in ONE photo (fractions of width/height).
 * Declared here (types.ts has zero imports) and re-exported from
 * prompts/photo-analysis.ts, so the schema source and the shared type share one
 * definition without a module cycle.
 */
export interface FaceBox {
  /** 1-based photo position at analysis time (asset-stamped by the worker). */
  pageNumber: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stamped by the worker post-hoc — survives reorders like appearsOnAssetIds. */
  assetId?: string | null;
}

export interface CharacterDescription {
  /** Unique identifier linking to a specific person across photos (e.g., "child_1", "adult_1") */
  characterId: string;
  /** Role in the story (e.g., "main_child", "parent", "sibling") */
  role: string;
  /** Character name if known from book metadata */
  name: string | null;
  /**
   * How `name` was established, stamped by the workers' capture-answer merge
   * (resolveCast): 'chip' = the parent tapped/typed it on a naming chip,
   * 'childName' = the setup sheet's child name, 'fallback' = derived from the
   * role. Absent on names the perception/extraction model filled from book
   * metadata. Deterministic QC name-coverage checks only trust
   * 'chip'/'childName' entries.
   */
  namedVia?: 'chip' | 'childName' | 'fallback';
  /**
   * Short plain-language label for WHAT this character is ("young boy", "toy
   * crocodile", "golden retriever"), so the sheet name-map can bind each grid
   * to the right character even when the name is misleading ("Grypho" the
   * croc). Additive/optional: absent on every identity written before this
   * field existed — consumers fall back to speciesLineFor's distillation.
   */
  species?: string | null;
  /**
   * Salience marker from the perception pass: true when this person/pet is
   * family or central to the day (recurring, interacting with the child),
   * false for one-photo background figures. Task 11's cast selection and
   * Wave 2/3 consumers read it to keep bystanders out of the cast. Optional:
   * absent on rosters written before this field existed.
   */
  isForeground?: boolean;
  /** Physical appearance traits extracted from photos */
  physicalTraits: {
    apparentAge: string;
    hairColor: string;
    hairStyle: string;
    skinTone: string;
    bodyBuild: string;
    distinguishingFeatures: string[];
  };
  /** Clothing observed across photos */
  typicalClothing: string;
  /** Style-specific rendering instructions (varies by art style) */
  styleTranslation: string;
  /** Which page numbers this character appears in */
  appearsOnPages: number[];
  /**
   * The assetIds behind appearsOnPages, stamped by the perception pass.
   * appearsOnPages is positional (creation order) and goes stale when the
   * parent reorders photos; remapping through these assetIds recovers the
   * correct current page numbers. Absent on identities produced by the
   * extraction worker (which always runs against the current order).
   */
  appearsOnAssetIds?: (string | null)[];
  /**
   * X17.2: chip-ready parent-facing phrase ("the little boy in the striped
   * shirt"), 8 words max. Absent on pre-X17.2 identities — consumers fall
   * back to the describeCharacter distiller.
   */
  descriptor?: string | null;
  /**
   * X17.2: normalized face rectangle in this character's clearest photo,
   * asset-stamped by the perception worker. Absent/null → face-crop
   * consumers fall back to a g_face thumbnail of their clearest photo.
   */
  faceBox?: FaceBox | null;
}

/**
 * Per-page defect-class flags (X12-C rubric v2). Each flag is judged against
 * the per-page context (expected cast + story text) and the reference sheets.
 * Convention: `true` ALWAYS means "the defect IS present". The two nullable
 * flags carry `null` for the no-op case (nothing to judge), so a class that
 * cannot be evaluated on a page is distinguishable from one judged clean.
 *
 * The blocking-vs-telemetry split lives in `QC_BLOCKING_CLASSES`
 * (`prompts/quality-check`), NOT here — the shape is stable while the gating
 * posture evolves.
 */
export interface QcClassFlags {
  /** BLOCKING: any rendered lettering at all, sound/onomatopoeia words included. */
  renderedText: boolean;
  /** BLOCKING: the SAME character drawn more than once in one image. */
  intraImageDuplicate: boolean;
  /** Telemetry: a character in the page's expected cast is absent from the art. */
  missingExpectedCast: boolean;
  /** Telemetry: a named character rendered as the wrong kind of creature (griffin-class). */
  speciesMismatch: boolean;
  /** Telemetry: one figure fusing two cast members, or a cast member fused with a non-cast creature. */
  characterHybrid: boolean;
  /**
   * Telemetry: a held prop drawn with the wrong holder. `null` when the page's
   * props carry no holder phrasing to judge (the no-op case).
   */
  propHolderMismatch: boolean | null;
  /**
   * Telemetry (B4): the art does NOT depict the page text's who-does-what.
   * `null` when the page has no story text to judge against.
   */
  focalActionMismatch: boolean | null;
  /**
   * Telemetry (X13 Track L): the art's emotional tone contradicts the page's
   * stated scene.mood. `null` when no mood was fed for this page.
   */
  moodMismatch: boolean | null;
}

/**
 * QC result for a single page illustration
 */
export interface PageQCResult {
  pageNumber: number;
  pageId: string;
  passed: boolean;
  issues: string[];
  characterConsistencyScore: number;
  styleConsistencyScore: number;
  overallScore: number;
  suggestedPromptAdditions: string | null;
  /**
   * Per-page defect-class flags (rubric v2). Sentinel (qc_error) rows carry the
   * all-clean/null default (`emptyQcClassFlags()`) — an unscored page, not a
   * clean verdict.
   */
  classFlags: QcClassFlags;
}

/**
 * QC result for the generated cover illustration (scored against its own
 * rubric variant: painted title text is EXPECTED and must match the book
 * title exactly).
 */
export interface CoverQCResult {
  passed: boolean;
  /** Whether the painted title matches the book title exactly. */
  titleMatches: boolean;
  characterConsistencyScore: number;
  styleConsistencyScore: number;
  overallScore: number;
  issues: string[];
  suggestedPromptAdditions: string | null;
}

/**
 * QC result for the entire book
 */
export interface BookQCResult {
  passed: boolean;
  qcRound: number;
  pageResults: PageQCResult[];
  failedPageIds: string[];
  summary: string;
  /** Present when the cover joined the QC call (CHARACTER_SHEETS_ENABLED). */
  coverResult?: CoverQCResult | null;
}
