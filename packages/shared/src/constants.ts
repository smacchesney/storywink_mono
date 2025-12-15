// Application constants
export const APP_NAME = 'Storywink.ai';
export const APP_DESCRIPTION = 'Transform your photos into personalized, illustrated children\'s storybooks with AI.';

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
} as const;

// Book constraints
export const BOOK_CONSTRAINTS = {
  MIN_PAGES: 6,
  MAX_PAGES: 20,
  DEFAULT_PAGES: 10,
  MIN_PHOTOS: 1,
  MAX_PHOTOS: 20,
  MAX_TITLE_LENGTH: 100,
  MAX_CHILD_NAME_LENGTH: 50,
} as const;

// File upload constraints
export const UPLOAD_CONSTRAINTS = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.webp'],
} as const;

// Art styles
export const ART_STYLES = [
  { id: 'watercolor', name: 'Watercolor', description: 'Soft, flowing watercolor paintings' },
  { id: 'cartoon', name: 'Cartoon', description: 'Bold, colorful cartoon illustrations' },
  { id: 'sketch', name: 'Sketch', description: 'Hand-drawn pencil sketches' },
  { id: 'digital', name: 'Digital', description: 'Modern digital art style' },
  { id: 'anime', name: 'Anime', description: 'Japanese anime-inspired artwork' },
] as const;

// Book status messages
export const STATUS_MESSAGES = {
  DRAFT: 'Setting up your storybook',
  GENERATING: 'Writing your magical story',
  STORY_READY: 'Story complete! Ready for illustrations',
  ILLUSTRATING: 'Creating beautiful illustrations',
  COMPLETED: 'Your storybook is ready!',
  FAILED: 'Something went wrong',
  PARTIAL: 'Partially completed',
} as const;