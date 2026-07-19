// Application constants
export const APP_NAME = 'Storywink.ai';
export const APP_DESCRIPTION =
  "Transform your photos into personalized, illustrated children's storybooks with AI.";

// API endpoints
export const API_ENDPOINTS = {
  BOOKS: '/api/books',
  PAGES: '/api/pages',
  ASSETS: '/api/assets',
  GENERATE: '/api/generate',
  UPLOAD: '/api/upload',
  AUTH: '/api/auth',
} as const;

// Queue names
export const QUEUE_NAMES = {
  STORY_GENERATION: 'story-generation',
  ILLUSTRATION_GENERATION: 'illustration-generation',
  BOOK_FINALIZE: 'book-finalize',
  PRINT_FULFILLMENT: 'print-fulfillment',
  CHARACTER_EXTRACTION: 'character-extraction',
  PHOTO_ANALYSIS: 'photo-analysis',
  BOOK_REAPER: 'book-reaper',
  LULU_STATUS_POLL: 'lulu-status-poll',
  ASSET_CLEANUP: 'asset-cleanup',
  AVATAR_RENDITION: 'avatar-rendition',
} as const;

// Book constraints
export const BOOK_CONSTRAINTS = {
  MIN_PAGES: 6,
  MAX_PAGES: 23,
  DEFAULT_PAGES: 10,
  MIN_PHOTOS: 1,
  MAX_PHOTOS: 23,
  MAX_TITLE_LENGTH: 100,
  MAX_CHILD_NAME_LENGTH: 50,
} as const;

// File upload constraints
export const UPLOAD_CONSTRAINTS = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.webp'],
} as const;

// Language configuration
export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  ja: '日本語',
} as const;

// Language-specific page text for dedication & ending pages
export const PAGE_TEXT = {
  en: {
    dedicationLine1: 'This book was made',
    dedicationLine2: 'especially for',
    endingTitle: 'The End',
    endingLine: 'Until next time,',
    collageTitle: 'The real adventure',
    andFriends: '& friends',
  },
  ja: {
    dedicationLine1: 'この えほんは',
    dedicationLine2: 'のために つくりました',
    endingTitle: 'おしまい',
    endingLine: 'またね、',
    collageTitle: 'ほんとうの ぼうけんは ここから',
    andFriends: 'と おともだち',
  },
} as const;

// ---------------------------------------------------------------------------
// Batch-avatar subject detection (X7) — retention contract
// ---------------------------------------------------------------------------

/** AppEvent name carrying a persisted detection (full subject PII) in props. */
export const AVATAR_DETECTION_EVENT = 'avatar_subject_detection';
/**
 * AppEvent name after redemption or expiry-strip: props hold ONLY
 * {assetIds} (opaque ids for the retention sweeps), never subject PII.
 */
export const AVATAR_DETECTION_CONSUMED_EVENT = 'avatar_subject_detection_consumed';
/** How long a stored detection may be redeemed by /api/avatars/batch. */
export const DETECTION_TTL_MS = 60 * 60 * 1000;
/**
 * Sweeps only touch rows older than TTL + grace, so a row a batch freshness
 * check could still accept is never visible to a concurrent sweep. This is
 * the PII-STRIP horizon: past it, a detection row keeps only {assetIds}.
 */
export const DETECTION_SWEEP_GRACE_MS = 5 * 60 * 1000;
/**
 * Photo-reap horizon (past the TTL): staged photos are only destroyed for
 * rows this old. PII strips at TTL+grace; the photos wait long enough that
 * no plausibly-open studio session (overnight tab, 410-recovery re-detect)
 * can have its uploads reaped out from under it by a sweep it cannot see.
 */
export const DETECTION_REAP_HORIZON_MS = 24 * 60 * 60 * 1000;

// Story mood options (canonical source — used by UI, schemas, and prompt)
export const STORY_MOODS = ['adventurous', 'silly', 'sweet', 'brave', 'dreamy', 'curious'] as const;
export type StoryMood = (typeof STORY_MOODS)[number];

export const STORY_MOOD_LABELS: Record<StoryMood, { en: string; ja: string }> = {
  adventurous: { en: 'Adventurous', ja: 'ぼうけん' },
  silly: { en: 'Silly & Funny', ja: 'おもしろい' },
  sweet: { en: 'Sweet & Cozy', ja: 'やさしい' },
  brave: { en: 'Brave & Bold', ja: 'ゆうかん' },
  dreamy: { en: 'Dreamy & Magical', ja: 'ゆめいっぱい' },
  curious: { en: 'Curious Explorer', ja: 'たんけん' },
} as const;
