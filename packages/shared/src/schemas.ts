import { z } from 'zod';
import { STORY_MOODS } from './constants.js';

// Supported book languages
export const SUPPORTED_LANGUAGES = ['en', 'ja'] as const;
export type BookLanguage = typeof SUPPORTED_LANGUAGES[number];

// API Request/Response schemas
export const createBookSchema = z.object({
  assetIds: z.array(z.string()).min(1, "At least one photo is required").max(23, "Maximum 23 photos allowed"),
  pageLength: z.number().int().min(6).max(23).default(10),
  language: z.enum(SUPPORTED_LANGUAGES).default('en'),
  artStyle: z.string().optional(),
  tone: z.enum(STORY_MOODS).optional(),
  theme: z.string().max(100).optional(),
});

// Schema for additional characters in the story
export const additionalCharacterSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name too long'),
  relationship: z.string().min(1, 'Relationship is required').max(50, 'Relationship too long'),
});

export const updateBookSchema = z.object({
  title: z.string().optional(),
  language: z.enum(SUPPORTED_LANGUAGES).optional(),
  artStyle: z.string().optional(),
  coverAssetId: z.string().optional(),
  childName: z.string().max(50, 'Name too long').nullable().optional(),
  additionalCharacters: z.array(additionalCharacterSchema).max(5, 'Maximum 5 characters').optional(),
  tone: z.enum(STORY_MOODS).nullable().optional(),
  theme: z.string().max(100).nullable().optional(),
  eventSummary: z.string().max(500).nullable().optional(),
  captureQuestions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        options: z.array(z.string()),
        // Links a naming question to its roster character — must round-trip
        // (zod strips unknown keys), or the answer can never merge back.
        characterId: z.string().max(50).nullable().optional(),
        // Same strip risk: 'object' drives the free-text-first chip.
        kind: z.enum(['naming', 'object', 'other']).nullish(),
        answer: z.string().nullable().optional(),
      }),
    )
    .max(5)
    .optional(),
  autoIllustrate: z.boolean().optional(),
});

export const updatePageSchema = z.object({
  text: z.string().optional(),
  textConfirmed: z.boolean().optional(),
  illustrationNotes: z.string().optional(),
});

export const generateStorySchema = z.object({
  bookId: z.string(),
  regenerate: z.boolean().optional(),
});

export const generateIllustrationSchema = z.object({
  bookId: z.string(),
  pageIds: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Story response additions (BRIDGE_PAGES_ENABLED)
// ---------------------------------------------------------------------------

/**
 * Shape validation for one model-proposed bridge page (story response).
 * The story worker validates-or-DROPS each entry against this schema before
 * the deterministic checks (cap, one-per-gap, roster subset) — a malformed
 * bridge must never fail the story job.
 */
export const bridgeSceneSchema = z.object({
  location: z.string().min(1).max(300),
  timeOfDay: z.string().min(1).max(100),
  action: z.string().min(1).max(500),
  charactersPresent: z.array(z.string().min(1).max(100)).min(1).max(8),
  outfitFrom: z.enum(['previous', 'next']),
  props: z.array(z.string().max(200)).max(10),
});

export const bridgePageResponseSchema = z.object({
  afterPhotoPage: z.number().int().min(1),
  text: z.string().trim().min(1).max(600),
  illustrationNotes: z.string().max(600).nullable(),
  scene: bridgeSceneSchema,
});

// Type exports
export type CreateBookInput = z.infer<typeof createBookSchema>;
export type UpdateBookInput = z.infer<typeof updateBookSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
export type GenerateStoryInput = z.infer<typeof generateStorySchema>;
export type GenerateIllustrationInput = z.infer<typeof generateIllustrationSchema>;
export type AdditionalCharacterInput = z.infer<typeof additionalCharacterSchema>;
export type BridgePageResponseInput = z.infer<typeof bridgePageResponseSchema>;