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

// Type exports
export type CreateBookInput = z.infer<typeof createBookSchema>;
export type UpdateBookInput = z.infer<typeof updateBookSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
export type GenerateStoryInput = z.infer<typeof generateStorySchema>;
export type GenerateIllustrationInput = z.infer<typeof generateIllustrationSchema>;
export type AdditionalCharacterInput = z.infer<typeof additionalCharacterSchema>;