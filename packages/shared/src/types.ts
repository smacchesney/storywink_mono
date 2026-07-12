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
export type BookStatus = "DRAFT" | "GENERATING" | "STORY_READY" | "ILLUSTRATING" | "COMPLETED" | "FAILED" | "PARTIAL";

/** PHOTO_STORY = made from uploaded photos; AVATAR_STORY = invented adventure starring account avatars (X6d). */
export type BookType = "PHOTO_STORY" | "AVATAR_STORY";

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
export type PageType = "SINGLE" | "SPREAD";

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