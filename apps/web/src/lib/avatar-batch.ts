/**
 * Pure helpers + request schemas for the batch character studio (X7).
 *
 * Security posture: the client NEVER supplies identity. Detect persists its
 * result server-side under a detectionId; batch rebuilds each avatar's
 * identity from that stored detection. These helpers are the tested core of
 * that rebuild (route-local zod moved here per the avatar-story-schema
 * precedent so bounds are pinned without prisma/queue mocks).
 */
import { z } from 'zod';
import {
  MAX_BATCH_PHOTOS,
  MAX_BATCH_SUBJECTS,
  type DetectedSubject,
} from '@storywink/shared/prompts/photo-analysis';
import { isValidStyle } from '@storywink/shared/prompts/styles';

/** Staged source photos per batch avatar — the worker reads at most 3 anyway. */
export const MAX_ASSETS_PER_SUBJECT = 3;

/** How long a stored detection may be redeemed by /api/avatars/batch. */
export const DETECTION_TTL_MS = 60 * 60 * 1000;

/** AppEvent name carrying a persisted detection in its props. */
export const AVATAR_DETECTION_EVENT = 'avatar_subject_detection';
/** AppEvent name after the detection is redeemed (single-use, atomic rename). */
export const AVATAR_DETECTION_CONSUMED_EVENT = 'avatar_subject_detection_consumed';

export const AVATAR_KINDS = ['CHILD', 'ADULT', 'PET', 'TOY'] as const;
export type AvatarKindString = (typeof AVATAR_KINDS)[number];

export const detectRequestSchema = z.object({
  assetIds: z.array(z.string().cuid()).min(1).max(MAX_BATCH_PHOTOS),
  language: z.enum(['en', 'ja']).default('en'),
});

export const batchRequestSchema = z
  .object({
    detectionId: z.string().cuid(),
    artStyle: z.string().refine(isValidStyle, 'Unknown art style'),
    picks: z
      .array(
        z.object({
          subjectId: z.string().min(1).max(64),
          /** Optional — the server falls back to the detection's defaultLabel. */
          name: z.string().max(50).optional(),
          kind: z.enum(AVATAR_KINDS),
        }),
      )
      .min(1)
      .max(MAX_BATCH_SUBJECTS),
  })
  .superRefine((body, ctx) => {
    const ids = body.picks.map((p) => p.subjectId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate subjectIds in picks' });
    }
  });

export type BatchRequest = z.infer<typeof batchRequestSchema>;

/** What detect persists in AppEvent.props (server-side only, never echoed raw). */
export interface StoredDetection {
  assetIds: string[];
  subjects: DetectedSubject[];
  language: string;
}

/** Forward mapping kind → roster role (inverse of kindForRole in avatars.ts). */
export function roleForKind(kind: AvatarKindString): string {
  switch (kind) {
    case 'CHILD':
      return 'main_child';
    case 'PET':
      return 'pet';
    case 'TOY':
      return 'companion_object';
    default:
      return 'adult';
  }
}

/**
 * Rebuild the AvatarIdentity JSON (the exact shape the rendition worker
 * expects) from a stored detection subject. The role follows the
 * PARENT-CHOSEN kind — the kind chip is a correction affordance, and the
 * pose/roster logic downstream keys on it. Parent-facing strings
 * (parentDescription, defaultLabel) never enter the identity.
 */
export function buildIdentityFromDetection(
  subject: DetectedSubject,
  displayName: string,
  kind: AvatarKindString,
) {
  return {
    character: {
      characterId: 'avatar_subject',
      role: roleForKind(kind),
      name: displayName,
      physicalTraits: subject.physicalTraits,
      typicalClothing: subject.typicalClothing,
      styleTranslation: subject.styleTranslation,
    },
    extractedForStyle: 'vignette',
  };
}

/**
 * The staged photos for one subject: best photo first (it becomes the sheet's
 * content anchor), then the rest of its photoIndexes, capped and de-duplicated.
 * Model output is untrusted — out-of-range indexes are dropped, so the result
 * is always a subset of the caller-owned upload.
 */
export function subjectAssetIds(subject: DetectedSubject, assetIds: string[]): string[] {
  const ordered = [
    subject.bestPhotoIndex,
    ...subject.photoIndexes.filter((i) => i !== subject.bestPhotoIndex),
  ];
  const picked: string[] = [];
  for (const index of ordered) {
    if (!Number.isInteger(index) || index < 1 || index > assetIds.length) continue;
    const id = assetIds[index - 1];
    if (!picked.includes(id)) picked.push(id);
    if (picked.length >= MAX_ASSETS_PER_SUBJECT) break;
  }
  return picked;
}

/**
 * The avatar's display name: the parent's typed name wins; otherwise the
 * detection's defaultLabel ("Grown-up with glasses") — renameable later from
 * the shelf kebab; a warm static fallback guards against an empty label.
 */
export function displayNameForPick(name: string | undefined, subject: DetectedSubject): string {
  const typed = name?.trim();
  if (typed) return typed.slice(0, 50);
  const label = subject.defaultLabel?.trim();
  if (label) return label.slice(0, 50);
  return 'Someone special';
}

/**
 * Smart include default (selection = consent): subjects in 2+ photos or
 * clearly foreground start selected; background one-offs start UNSELECTED —
 * inaction must never manufacture an avatar of a stranger from a photo
 * background.
 */
export function defaultSelected(subject: DetectedSubject): boolean {
  return subject.photoIndexes.length >= 2 || subject.isForeground;
}
