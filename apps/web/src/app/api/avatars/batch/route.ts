import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { assertCanCreateAvatar } from '@/lib/entitlements';
import { avatarsEnabled } from '@/lib/avatars';
import { checkRateLimit } from '@/lib/rateLimit';
import { QueueName, getQueue } from '@/lib/queue/index';
import {
  batchRequestSchema,
  buildIdentityFromDetection,
  displayNameForPick,
  subjectAssetIds,
  AVATAR_DETECTION_EVENT,
  AVATAR_DETECTION_CONSUMED_EVENT,
  DETECTION_TTL_MS,
  type StoredDetection,
} from '@/lib/avatar-batch';

/**
 * Batch studio step 2: create one avatar per confirmed pick. Identity is
 * rebuilt SERVER-SIDE from the stored detection — the client sends only
 * {subjectId, name?, kind}, so there is no identity-injection surface.
 * The detection is single-use (atomic rename) and expires after 1 hour.
 * Each avatar creates in its own transaction: partial success is fine and
 * reported ({created, failed, stoppedAtCap}).
 */
export async function POST(request: NextRequest) {
  if (!avatarsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const { dbUser } = await getAuthenticatedUser();

    // Money route: up to 6 rendition jobs per call.
    const rl = await checkRateLimit(`avatar-batch:${dbUser.id}`, 10, 3600);
    if (!rl.allowed) {
      logger.warn({ dbUserId: dbUser.id }, 'Rate limit exceeded: avatar batch');
      if (process.env.RATE_LIMIT_ENFORCE === 'true') {
        return NextResponse.json(
          { error: "You're going very quickly. Please wait a little while and try again." },
          { status: 429 },
        );
      }
    }

    const parsed = batchRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { detectionId, artStyle, picks } = parsed.data;

    // Tenancy pin: the detection must be this caller's, fresh, and unused.
    const detectionEvent = await prisma.appEvent.findUnique({ where: { id: detectionId } });
    if (
      !detectionEvent ||
      detectionEvent.userId !== dbUser.id ||
      (detectionEvent.name !== AVATAR_DETECTION_EVENT &&
        detectionEvent.name !== AVATAR_DETECTION_CONSUMED_EVENT)
    ) {
      return NextResponse.json({ error: 'Detection not found' }, { status: 404 });
    }
    if (detectionEvent.name === AVATAR_DETECTION_CONSUMED_EVENT) {
      return NextResponse.json({ code: 'DETECTION_USED' }, { status: 409 });
    }
    if (Date.now() - detectionEvent.createdAt.getTime() > DETECTION_TTL_MS) {
      return NextResponse.json({ code: 'DETECTION_EXPIRED' }, { status: 410 });
    }
    const stored = detectionEvent.props as unknown as StoredDetection;
    const subjectsById = new Map(stored.subjects.map((s) => [s.subjectId, s]));

    // Validate every pick against the stored roster BEFORE consuming.
    for (const pick of picks) {
      if (!subjectsById.has(pick.subjectId)) {
        return NextResponse.json({ error: 'Unknown subject in picks' }, { status: 400 });
      }
    }

    // Single-use redemption: the atomic rename lets exactly ONE request in —
    // a double-tap cannot mint the whole batch twice.
    const consumed = await prisma.appEvent.updateMany({
      where: { id: detectionId, name: AVATAR_DETECTION_EVENT },
      data: { name: AVATAR_DETECTION_CONSUMED_EVENT },
    });
    if (consumed.count === 0) {
      return NextResponse.json({ code: 'DETECTION_USED' }, { status: 409 });
    }

    // Staged photos may have been deleted since detect — keep only survivors.
    const liveAssets = await prisma.asset.findMany({
      where: { id: { in: stored.assetIds }, userId: dbUser.id },
      select: { id: true },
    });
    const liveAssetIds = new Set(liveAssets.map((a) => a.id));

    const created: Array<{ avatarId: string; displayName: string }> = [];
    const failed: Array<{ subjectId: string; reason: string }> = [];
    let stoppedAtCap: number | undefined;

    for (const pick of picks) {
      const subject = subjectsById.get(pick.subjectId)!;

      const verdict = await assertCanCreateAvatar(dbUser.id);
      if (!verdict.allowed) {
        // Stop honestly: the UI says "the first N were made".
        stoppedAtCap = verdict.cap;
        break;
      }

      const stagedIds = subjectAssetIds(subject, stored.assetIds).filter((id) =>
        liveAssetIds.has(id),
      );
      if (stagedIds.length === 0) {
        failed.push({ subjectId: pick.subjectId, reason: 'no_photos' });
        continue;
      }

      const displayName = displayNameForPick(pick.name, subject);
      try {
        const avatar = await prisma.avatar.create({
          data: {
            userId: dbUser.id,
            displayName,
            kind: pick.kind,
            identity: buildIdentityFromDetection(subject, displayName, pick.kind),
            photos: { create: stagedIds.map((assetId) => ({ assetId })) },
            renditions: { create: [{ artStyle, status: 'PENDING' }] },
          },
        });
        try {
          await getQueue(QueueName.AvatarRendition).add(
            `avatar-${avatar.id}-${artStyle}`,
            { avatarId: avatar.id, userId: dbUser.id, artStyle },
            { attempts: 2, backoff: { type: 'exponential', delay: 10000 } },
          );
        } catch (queueError) {
          // Never leave PENDING with no job behind it — FAILED offers an
          // honest "draw again" on the shelf.
          await prisma.avatarRendition
            .updateMany({
              where: { avatarId: avatar.id, artStyle },
              data: { status: 'FAILED', error: 'enqueue' },
            })
            .catch(() => {});
          logger.error(
            { avatarId: avatar.id, error: queueError },
            'Batch avatar rendition enqueue failed',
          );
        }
        created.push({ avatarId: avatar.id, displayName });
      } catch (createError) {
        logger.error(
          { subjectId: pick.subjectId, error: createError },
          'Batch avatar creation failed',
        );
        failed.push({ subjectId: pick.subjectId, reason: 'create' });
      }
    }

    logger.info(
      { detectionId, created: created.length, failed: failed.length, stoppedAtCap },
      'Batch avatar creation finished',
    );
    return NextResponse.json(
      {
        created,
        ...(failed.length > 0 ? { failed } : {}),
        ...(stoppedAtCap !== undefined ? { stoppedAtCap } : {}),
      },
      { status: created.length > 0 ? 201 : 200 },
    );
  } catch (error) {
    logger.error({ error }, 'Batch avatar creation failed');
    return NextResponse.json({ error: 'Failed to create characters' }, { status: 500 });
  }
}
