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

export interface Book {
  id: string;
  userId: string;
  title: string;
  childName: string;
  status: BookStatus;
  pageLength: number;
  artStyle?: string | null;
  tone?: string | null;
  typography?: string | null;
  theme?: string | null;
  keyCharacters?: string | null;
  specialObjects?: string | null;
  excitementElement?: string | null;
  coverAssetId?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  isWinkifyEnabled: boolean;
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
  childName: string;
  isWinkifyEnabled: boolean;
  isTitlePage: boolean;
  illustrationNotes?: string | null;
  originalImageUrl?: string | null;
}

export interface BookFinalizeJob {
  bookId: string;
  userId: string;
}