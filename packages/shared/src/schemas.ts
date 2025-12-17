import { z } from 'zod';

// API Request/Response schemas
export const createBookSchema = z.object({
  assetIds: z.array(z.string()).min(1, "At least one photo is required"),
  pageLength: z.number().int().min(6).max(20).default(10),
  artStyle: z.string().optional(),
  tone: z.string().optional(),
  theme: z.string().optional(),
});

export const updateBookSchema = z.object({
  title: z.string().optional(),
  artStyle: z.string().optional(),
  coverAssetId: z.string().optional(),
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