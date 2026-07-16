/**
 * Request schema for the AVATAR_STORY create branch (X6d), extracted from
 * the route so its bounds are unit-testable (Next route files may only
 * export handlers).
 */
import { z } from 'zod';
import { AVATAR_STORY_PAGE_LENGTHS, PREMISE_MAX_CHARS } from './avatar-story';

export const createAvatarBookSchema = z.object({
  bookType: z.literal('AVATAR_STORY'),
  avatarIds: z
    .array(z.string().cuid())
    .min(1, { message: 'Pick at least one character.' })
    .max(6, { message: 'Six characters at most.' }),
  premise: z.string().trim().min(1).max(PREMISE_MAX_CHARS),
  pageLength: z
    .number()
    .int()
    .refine((n): n is (typeof AVATAR_STORY_PAGE_LENGTHS)[number] =>
      (AVATAR_STORY_PAGE_LENGTHS as readonly number[]).includes(n),
    ),
  artStyle: z.string().min(1).max(50),
  language: z.enum(['en', 'ja']).default('en'),
});

export type CreateAvatarBookInput = z.infer<typeof createAvatarBookSchema>;
