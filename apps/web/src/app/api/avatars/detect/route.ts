import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { avatarsEnabled, reapUnattachedStagedAssets } from '@/lib/avatars';
import { checkRateLimit } from '@/lib/rateLimit';
import {
  detectRequestSchema,
  AVATAR_DETECTION_EVENT,
  AVATAR_DETECTION_CONSUMED_EVENT,
  DETECTION_TTL_MS,
  type StoredDetection,
} from '@/lib/avatar-batch';
import {
  createSubjectDetectionPrompt,
  SUBJECT_DETECTION_SYSTEM_PROMPT,
  SUBJECT_DETECTION_RESPONSE_SCHEMA,
  MAX_BATCH_SUBJECTS,
  type SubjectDetectionResponse,
} from '@storywink/shared/prompts/photo-analysis';
import { optimizeCloudinaryUrlForVision } from '@storywink/shared/utils';

// Perception tier (mirrors apps/workers/src/config/models.ts).
const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'gpt-5-mini';

/**
 * Delete this user's expired detection rows and reap the staged photos any
 * abandoned (detect-but-never-create) session left behind. Fire-and-forget
 * from the request path — a failure here never blocks a detect.
 */
async function sweepExpiredDetections(dbUserId: string): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - DETECTION_TTL_MS);
    const expired = await prisma.appEvent.findMany({
      where: {
        userId: dbUserId,
        name: { in: [AVATAR_DETECTION_EVENT, AVATAR_DETECTION_CONSUMED_EVENT] },
        createdAt: { lt: cutoff },
      },
      select: { id: true, name: true, props: true },
    });
    if (expired.length === 0) return;

    // Only UNCONSUMED rows still hold staged photos worth reaping — consumed
    // rows already released theirs at create time and carry stripped props.
    const orphanAssetIds = expired
      .filter((e) => e.name === AVATAR_DETECTION_EVENT)
      .flatMap((e) => (e.props as unknown as StoredDetection | null)?.assetIds ?? []);
    await prisma.appEvent.deleteMany({ where: { id: { in: expired.map((e) => e.id) } } });
    if (orphanAssetIds.length > 0) {
      await reapUnattachedStagedAssets(dbUserId, orphanAssetIds);
    }
  } catch (error) {
    logger.warn({ dbUserId, error }, 'Detection sweep failed (non-fatal)');
  }
}

/**
 * Batch studio step 1: one vision call over the uploaded photos → who could
 * become a character. The full detection (identity traits included) persists
 * SERVER-SIDE under a detectionId; the client only ever sees parent-facing
 * fields, and /api/avatars/batch rebuilds identity from the stored copy —
 * client-supplied identity is never trusted.
 */
export async function POST(request: NextRequest) {
  if (!avatarsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const { dbUser } = await getAuthenticatedUser();

    // A money route (one vision call over up to 10 photos) — cap the burst.
    const rl = await checkRateLimit(`avatar-detect:${dbUser.id}`, 20, 3600);
    if (!rl.allowed) {
      logger.warn({ dbUserId: dbUser.id }, 'Rate limit exceeded: avatar detect');
      if (process.env.RATE_LIMIT_ENFORCE === 'true') {
        return NextResponse.json(
          { error: "You're going very quickly. Please wait a little while and try again." },
          { status: 429 },
        );
      }
    }

    const parsed = detectRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { assetIds, language } = parsed.data;

    // Retention sweep: this caller's expired detections carry AI-derived
    // descriptions of everyone in the photos (including background strangers).
    // Delete the rows and reap any staged photos those abandoned sessions left
    // behind — the "we only use photos to draw, then let them go" promise.
    void sweepExpiredDetections(dbUser.id);

    // Ownership pin: every photo must be the caller's own upload.
    const owned = await prisma.asset.findMany({
      where: { id: { in: assetIds }, userId: dbUser.id },
      select: { id: true, url: true, thumbnailUrl: true },
    });
    if (owned.length !== assetIds.length) {
      return NextResponse.json({ error: 'Invalid asset ownership' }, { status: 400 });
    }
    // photoIndexes are positional — the model sees photos in REQUEST order.
    const byId = new Map(owned.map((a) => [a.id, a]));
    const photos = assetIds.map((id) => byId.get(id)!);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({
      model: ANALYSIS_MODEL,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: SUBJECT_DETECTION_SYSTEM_PROMPT }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: createSubjectDetectionPrompt({ photoCount: photos.length, language }),
            },
            ...photos.map((photo) => ({
              type: 'input_image' as const,
              image_url: optimizeCloudinaryUrlForVision(photo.url),
              detail: 'high' as const,
            })),
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'subject_detection',
          strict: true,
          schema: SUBJECT_DETECTION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });

    const detection = JSON.parse(response.output_text) as SubjectDetectionResponse;
    // Model output is untrusted: clamp the cap, dedupe subjectIds (a repeated
    // id would 400 the batch schema and entangle the confirm cards), sanitize
    // photo indexes, and DROP any subject with no valid photo — it has no
    // thumbnail and can't be drawn, so it must never reach the roster or
    // fabricate a photo link the model never asserted.
    const seenSubjectIds = new Set<string>();
    const subjects = (detection.subjects ?? [])
      .filter((subject) => {
        if (!subject.subjectId || seenSubjectIds.has(subject.subjectId)) return false;
        seenSubjectIds.add(subject.subjectId);
        return true;
      })
      .map((subject) => {
        const photoIndexes = Array.from(
          new Set(
            (subject.photoIndexes ?? []).filter(
              (i) => Number.isInteger(i) && i >= 1 && i <= photos.length,
            ),
          ),
        );
        const bestPhotoIndex =
          Number.isInteger(subject.bestPhotoIndex) &&
          subject.bestPhotoIndex >= 1 &&
          subject.bestPhotoIndex <= photos.length &&
          photoIndexes.includes(subject.bestPhotoIndex)
            ? subject.bestPhotoIndex
            : photoIndexes[0];
        return { ...subject, photoIndexes, bestPhotoIndex };
      })
      .filter((subject) => subject.photoIndexes.length > 0 && subject.bestPhotoIndex !== undefined)
      .slice(0, MAX_BATCH_SUBJECTS);

    const stored: StoredDetection = { assetIds, subjects, language };
    const event = await prisma.appEvent.create({
      data: {
        name: AVATAR_DETECTION_EVENT,
        userId: dbUser.id,
        props: stored as unknown as object,
      },
    });

    // Parent-facing fields only — traits and styleTranslation stay server-side.
    return NextResponse.json({
      detectionId: event.id,
      subjects: subjects.map((subject) => {
        const best = photos[subject.bestPhotoIndex - 1];
        return {
          subjectId: subject.subjectId,
          kindGuess: subject.kindGuess,
          parentDescription: subject.parentDescription,
          defaultLabel: subject.defaultLabel,
          isForeground: subject.isForeground,
          photoCount: subject.photoIndexes.length,
          photoIndexes: subject.photoIndexes,
          thumbnailUrl: best?.thumbnailUrl ?? best?.url ?? null,
        };
      }),
    });
  } catch (error) {
    logger.error({ error }, 'Avatar subject detection failed');
    return NextResponse.json({ error: 'Failed to look through the photos' }, { status: 500 });
  }
}
