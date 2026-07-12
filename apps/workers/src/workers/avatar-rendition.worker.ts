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
  sheetSubjectForStyle,
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

  const rendition = await prisma.avatarRendition.upsert({
    where: { avatarId_artStyle: { avatarId, artStyle } },
    create: { avatarId, artStyle, status: 'PENDING' },
    update: { status: 'PENDING', error: null },
  });

  try {
    // Promotion fast path: byte-copy the book's validated sheet.
    if (job.data.copyFromSheetUrl) {
      const copied = await copySheetIntoAvatarFolder(avatarId, artStyle, job.data.copyFromSheetUrl);
      await prisma.avatarRendition.update({
        where: { id: rendition.id },
        data: {
          status: 'READY',
          turnaroundSheetUrl: copied,
          portraitUrl: portraitUrlFromSheet(copied),
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

    await prisma.avatarRendition.update({
      where: { id: rendition.id },
      data: {
        status: 'READY',
        turnaroundSheetUrl: result.turnaroundSheetUrl,
        portraitUrl: result.portraitUrl,
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
