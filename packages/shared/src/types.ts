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
}

/**
 * Extended illustration job with character identity and QC feedback.
 */
export interface IllustrationGenerationJobV2 extends IllustrationGenerationJob {
  characterIdentity?: CharacterIdentity | null;
  qcRound?: number;
  qcFeedback?: string | null;
}

/**
 * Canonical character identity extracted from all photos via Gemini vision.
 * Generated once per book, injected into every illustration prompt.
 */
export interface CharacterIdentity {
  characters: CharacterDescription[];
  sceneContext: string;
}

export interface CharacterDescription {
  /** Unique identifier linking to a specific person across photos (e.g., "child_1", "adult_1") */
  characterId: string;
  /** Role in the story (e.g., "main_child", "parent", "sibling") */
  role: string;
  /** Character name if known from book metadata */
  name: string | null;
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
 * QC result for the entire book
 */
export interface BookQCResult {
  passed: boolean;
  qcRound: number;
  pageResults: PageQCResult[];
  failedPageIds: string[];
  summary: string;
}