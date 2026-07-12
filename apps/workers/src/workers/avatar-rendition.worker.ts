/**
 * Avatar rendition worker: makes (or remakes) the styled master reference for
 * one (avatar, artStyle) pair.
 *
 * Sources, in preference order:
 * 1. Staged photos (AvatarPhoto → Asset) — the studio path, pre-approval.
 * 2. An existing READY rendition's sheet — deriving a NEW style after the
 *    source photos were deleted (delete-after-approval), per the
 *    "lock the features, vary the context" consistency pattern.
 *
 * The job never leaves a rendition stuck PENDING: any failure marks FAILED
 * with the error string the UI shows behind "Draw again".
 */
import { Job } from 'bullmq';
import OpenAI from 'openai';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import { optimizeCloudinaryUrlForVision } from '@storywink/shared/utils';
import {
  extractAvatarIdentity,
  generateAvatarSheet,
  generateAvatarCutout,
  sheetSubjectForStyle,
  cutoutSubjectForStyle,
  portraitUrlFromSheet,
  copySheetIntoAvatarFolder,
  type AvatarIdentity,
} from '../lib/avatar-renditions.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface AvatarRenditionJobData {
  avatarId: string;
  userId: string;
  artStyle: string;
  /**
   * Promotion fast path: copy this already-validated BOOK sheet into the
   * avatar's own folder (so book deletion can't strand the avatar) instead
   * of generating anew — the parent keeps exactly the character they saw.
   */
  copyFromSheetUrl?: string;
  /**
   * Backfill path (X7): only generate the waving cutout for an already-READY
   * rendition. The card must never re-enter a working state — no PENDING
   * flip, no status change, and the cutout silently swaps in when it lands.
   */
  cutoutOnly?: boolean;
}

export async function processAvatarRendition(job: Job<AvatarRenditionJobData>): Promise<void> {
  const { avatarId, userId, artStyle } = job.data;
  logger.info({ avatarId, artStyle, jobId: job.id }, 'Avatar rendition job started');

  const avatar = await prisma.avatar.findUnique({
    where: { id: avatarId, userId },
    include: {
      photos: { include: { asset: { select: { url: true } } } },
      renditions: true,
    },
  });
  if (!avatar) {
    logger.warn({ avatarId }, 'Avatar gone before rendition ran — nothing to do');
    return;
  }

  // X7 backfill path: cutout only, BEFORE the PENDING upsert — a finished
  // character must never look re-opened while its cutout draws.
  if (job.data.cutoutOnly) {
    const existing = avatar.renditions.find((r) => r.artStyle === artStyle);
    const identity = avatar.identity as unknown as AvatarIdentity | null;
    if (!existing || existing.status !== 'READY' || !existing.turnaroundSheetUrl) {
      logger.warn({ avatarId, artStyle }, 'Cutout-only job without a READY sheet — skipping');
      return;
    }
    if (existing.cutoutUrl) {
      logger.info({ avatarId, artStyle }, 'Cutout already present — skipping (idempotent)');
      return;
    }
    if (!identity?.character) {
      logger.warn({ avatarId, artStyle }, 'Cutout-only job without identity — skipping');
      return;
    }
    const cutoutUrl = await generateAvatarCutout({
      openai,
      avatarId,
      artStyle,
      kind: avatar.kind,
      subject: cutoutSubjectForStyle(identity, artStyle),
      sheetUrl: existing.turnaroundSheetUrl,
      logger,
    });
    if (cutoutUrl) {
      await prisma.avatarRendition.update({
        where: { id: existing.id },
        data: { cutoutUrl },
      });
    }
    return;
  }

  const rendition = await prisma.avatarRendition.upsert({
    where: { avatarId_artStyle: { avatarId, artStyle } },
    create: { avatarId, artStyle, status: 'PENDING' },
    update: { status: 'PENDING', error: null },
  });

  try {
    // Promotion fast path: byte-copy the book's validated sheet. The cutout
    // still generates fresh — the copied sheet is its identity anchor.
    if (job.data.copyFromSheetUrl) {
      const copied = await copySheetIntoAvatarFolder(avatarId, artStyle, job.data.copyFromSheetUrl);
      const promoIdentity = avatar.identity as unknown as AvatarIdentity | null;
      const cutoutUrl = promoIdentity?.character
        ? await generateAvatarCutout({
            openai,
            avatarId,
            artStyle,
            kind: avatar.kind,
            subject: cutoutSubjectForStyle(promoIdentity, artStyle),
            sheetUrl: copied,
            logger,
          })
        : null;
      await prisma.avatarRendition.update({
        where: { id: rendition.id },
        data: {
          status: 'READY',
          turnaroundSheetUrl: copied,
          portraitUrl: portraitUrlFromSheet(copied),
          cutoutUrl,
          provider: 'copy',
          model: 'book-sheet',
          validatedAt: new Date(),
          error: null,
        },
      });
      await prisma.avatar.update({ where: { id: avatarId }, data: { status: 'READY' } });
      logger.info({ avatarId, artStyle }, 'Avatar rendition copied from book sheet');
      return;
    }

    // Source images: staged photos first, else a prior validated sheet.
    const photoUrls = avatar.photos.map((p) => p.asset?.url).filter((url): url is string => !!url);
    const fallbackSheet = avatar.renditions.find(
      (r) => r.status === 'READY' && r.turnaroundSheetUrl && r.artStyle !== artStyle,
    )?.turnaroundSheetUrl;
    const sourceUrls = photoUrls.length > 0 ? photoUrls : fallbackSheet ? [fallbackSheet] : [];
    if (sourceUrls.length === 0) {
      throw new Error('No source photos and no prior rendition to derive from');
    }

    // Identity: extract once from real photos; reuse thereafter.
    let identity = avatar.identity as unknown as AvatarIdentity | null;
    if (!identity?.character) {
      if (photoUrls.length === 0) {
        throw new Error('Avatar has no identity and no photos to extract one from');
      }
      identity = await extractAvatarIdentity({
        openai,
        kind: avatar.kind,
        displayName: avatar.displayName,
        artStyle,
        sourceUrls: photoUrls.map((url) => optimizeCloudinaryUrlForVision(url)),
        logger,
      });
      await prisma.avatar.update({
        where: { id: avatarId },
        data: { identity: identity as unknown as object },
      });
    }

    const result = await generateAvatarSheet({
      openai,
      avatarId,
      artStyle,
      subject: sheetSubjectForStyle(identity, artStyle),
      sourceUrls,
      logger,
    });

    // The waving cutout (X7): sheet-anchored, garnish — null on failure and
    // the card falls back to the portrait crop. Never fails the rendition.
    const cutoutUrl = await generateAvatarCutout({
      openai,
      avatarId,
      artStyle,
      kind: avatar.kind,
      subject: cutoutSubjectForStyle(identity, artStyle),
      sheetUrl: result.turnaroundSheetUrl,
      logger,
    });

    await prisma.avatarRendition.update({
      where: { id: rendition.id },
      data: {
        status: 'READY',
        turnaroundSheetUrl: result.turnaroundSheetUrl,
        portraitUrl: result.portraitUrl,
        cutoutUrl,
        provider: result.provider,
        model: result.model,
        validatedAt: new Date(),
        error: null,
      },
    });
    await prisma.avatar.update({
      where: { id: avatarId },
      data: { status: 'READY' },
    });
    logger.info({ avatarId, artStyle }, 'Avatar rendition READY');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ avatarId, artStyle, error: message }, 'Avatar rendition failed');
    await prisma.avatarRendition.update({
      where: { id: rendition.id },
      data: { status: 'FAILED', error: message.slice(0, 500) },
    });
    throw error; // let BullMQ retry policy decide
  }
}
