import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { assertCanCreateAvatar } from '@/lib/entitlements';
import { avatarsEnabled, reapUnattachedStagedAssets } from '@/lib/avatars';
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

    // Money route: up to 6 rendition jobs per call. Enforced unconditionally
    // (checkRateLimit fails open if Redis is unreachable).
    const rl = await checkRateLimit(`avatar-batch:${dbUser.id}`, 10, 3600);
    if (!rl.allowed) {
      logger.warn({ dbUserId: dbUser.id }, 'Rate limit exceeded: avatar batch');
      return NextResponse.json(
        { error: "You're going very quickly. Please wait a little while and try again." },
        { status: 429 },
      );
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
    const stored = detectionEvent.props as unknown as StoredDetection;
    if (Date.now() - detectionEvent.createdAt.getTime() > DETECTION_TTL_MS) {
      // Strip the subject PII the moment expiry is observed — the retention
      // promise must not wait for a future sweep. The {assetIds}-only rename
      // keeps the staged photos discoverable for that sweep while the client
      // re-detects over them (they are NOT reaped here for exactly that
      // reason).
      await prisma.appEvent.updateMany({
        where: { id: detectionId, name: AVATAR_DETECTION_EVENT },
        data: { name: AVATAR_DETECTION_CONSUMED_EVENT, props: { assetIds: stored.assetIds } },
      });
      return NextResponse.json({ code: 'DETECTION_EXPIRED' }, { status: 410 });
    }
    const subjectsById = new Map(stored.subjects.map((s) => [s.subjectId, s]));

    // Validate every pick against the stored roster BEFORE consuming.
    for (const pick of picks) {
      if (!subjectsById.has(pick.subjectId)) {
        return NextResponse.json({ error: 'Unknown subject in picks' }, { status: 400 });
      }
    }

    // Capacity pre-check BEFORE the single-use consume: a user already at the
    // avatar cap would otherwise burn their detection, create zero, and get
    // funnelled into paid re-detects. Fail here with the cap payload and the
    // detection survives for a retry after they free a slot.
    const capacity = await assertCanCreateAvatar(dbUser.id);
    if (!capacity.allowed) {
      return NextResponse.json({ code: 'AVATAR_CAP', cap: capacity.cap }, { status: 403 });
    }

    // Single-use redemption: the atomic rename lets exactly ONE request in —
    // a double-tap cannot mint the whole batch twice. Subject PII is STRIPPED
    // in the same write so no AI-derived descriptions of children (or
    // non-consenting background strangers) survive past the create — the
    // retention promise. Only the opaque assetIds remain, so the sweep can
    // later reap any photo that ended up attached to nothing.
    const consumed = await prisma.appEvent.updateMany({
      where: { id: detectionId, name: AVATAR_DETECTION_EVENT },
      data: { name: AVATAR_DETECTION_CONSUMED_EVENT, props: { assetIds: stored.assetIds } },
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
    const createdSubjectIds = new Set<string>();
    const failed: Array<{ subjectId: string; reason: string }> = [];
    let enqueueFailures = 0;
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

      const displayName = displayNameForPick(pick.name, subject, stored.language);
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
            {
              avatarId: avatar.id,
              userId: dbUser.id,
              artStyle,
              // Anchor a future identity re-extraction (X11 Track F): the group
              // photo may hold more than one figure, so carry this subject's
              // detect-stage line so the worker draws THIS one if it ever has to
              // rebuild identity from the staged photos.
              subjectDescription: subject.parentDescription,
            },
            { attempts: 2, backoff: { type: 'exponential', delay: 10000 } },
          );
        } catch (queueError) {
          // Never leave PENDING with no job behind it — FAILED offers an
          // honest "draw again" on the shelf. Counted so the client can say
          // some drawings need another go instead of claiming a clean run.
          enqueueFailures += 1;
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
        createdSubjectIds.add(pick.subjectId);
      } catch (createError) {
        logger.error(
          { subjectId: pick.subjectId, error: createError },
          'Batch avatar creation failed',
        );
        failed.push({ subjectId: pick.subjectId, reason: 'create' });
      }
    }

    // Cap race: the pre-check passed but a concurrent create used the last
    // slot before the loop ran. Nothing was made, so honor the 403 contract
    // the client already handles (detection NOT burned, stay on confirm) —
    // restore the consumed row with its original props for the retry.
    if (created.length === 0 && stoppedAtCap !== undefined) {
      await prisma.appEvent.updateMany({
        where: { id: detectionId, name: AVATAR_DETECTION_CONSUMED_EVENT },
        data: { name: AVATAR_DETECTION_EVENT, props: stored as unknown as object },
      });
      return NextResponse.json({ code: 'AVATAR_CAP', cap: stoppedAtCap }, { status: 403 });
    }

    // Retention: staged photos that ended up attached to no avatar (beyond the
    // ≤3/subject cap, or belonging to unselected subjects) are reaped now —
    // reapUnattachedStagedAssets keeps only the ids no page/cover/avatar
    // references, so the created avatars' photos are safe.
    //
    // ONLY when at least one avatar was created (a total failure keeps every
    // photo so a re-detect over the same set stays viable), and NEVER the
    // photos of picks that failed or were cap-stopped — their retry story
    // (free a slot, re-detect) needs those photos alive. Whatever survives
    // here is reaped by the detection sweeps once the consumed row's
    // {assetIds} props pass the reap horizon (and byte deletion is enforced).
    if (created.length > 0) {
      const unresolvedAssetIds = new Set(
        picks
          .filter((pick) => !createdSubjectIds.has(pick.subjectId))
          .flatMap((pick) => subjectAssetIds(subjectsById.get(pick.subjectId)!, stored.assetIds)),
      );
      await reapUnattachedStagedAssets(
        dbUser.id,
        stored.assetIds.filter((id) => !unresolvedAssetIds.has(id)),
      );
    }

    logger.info(
      {
        detectionId,
        created: created.length,
        failed: failed.length,
        enqueueFailures,
        stoppedAtCap,
      },
      'Batch avatar creation finished',
    );
    return NextResponse.json(
      {
        created,
        ...(failed.length > 0 ? { failed } : {}),
        ...(enqueueFailures > 0 ? { enqueueFailures } : {}),
        ...(stoppedAtCap !== undefined ? { stoppedAtCap } : {}),
      },
      { status: created.length > 0 ? 201 : 200 },
    );
  } catch (error) {
    logger.error({ error }, 'Batch avatar creation failed');
    return NextResponse.json({ error: 'Failed to create characters' }, { status: 500 });
  }
}
