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
import { extractCloudinaryPublicId } from '@storywink/shared';
import {
  extractAvatarIdentity,
  generateAvatarSheet,
  generateAvatarCutout,
  destroyCutoutVariants,
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
  /**
   * Per-subject description from the detect stage (X11 Track F). Only used when
   * this job has to extract identity from scratch (missing identity) — it binds
   * extraction to the right figure in a group photo. Redis-transient; absent on
   * the studio and relearn paths.
   */
  subjectDescription?: string;
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
    const anchorSheet = existing.turnaroundSheetUrl;
    // Per-job public_id suffix: a concurrent draw-again owns the bare
    // cutout_<style> ids, so this job's uploads must live at their own ids —
    // otherwise the LAST upload owns the bytes every stored URL serves,
    // and a slow stale backfill would clobber the redraw's fresh cutout.
    const suffix = `_bf${(job.id ?? 'x').replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`;
    const cutoutUrl = await generateAvatarCutout({
      openai,
      avatarId,
      artStyle,
      kind: avatar.kind,
      subject: cutoutSubjectForStyle(identity, artStyle),
      sheetUrl: anchorSheet,
      publicIdSuffix: suffix,
      logger,
    });
    if (cutoutUrl) {
      // Guard against a "draw again" that redrew this rendition while the
      // backfill cutout was generating: write ONLY if the rendition is still
      // READY on the sheet we anchored to AND no cutout landed meanwhile.
      // A concurrent redraw (PENDING now, or READY on a new sheet) wins —
      // this stale one is dropped and its uploads are reaped.
      const written = await prisma.avatarRendition.updateMany({
        where: {
          id: existing.id,
          status: 'READY',
          cutoutUrl: null,
          turnaroundSheetUrl: anchorSheet,
        },
        data: { cutoutUrl },
      });
      if (written.count === 0) {
        logger.info(
          { avatarId, artStyle },
          'Cutout-only write skipped — rendition changed under us (redraw won)',
        );
        await destroyCutoutVariants(cutoutUrl, logger);
      }
    }
    return;
  }

  // Snapshot the pre-redraw cutout so a suffixed one (promotion/backfill
  // patch) can be reaped once this redraw supersedes it.
  const priorCutoutUrl = avatar.renditions.find((r) => r.artStyle === artStyle)?.cutoutUrl ?? null;

  const rendition = await prisma.avatarRendition.upsert({
    where: { avatarId_artStyle: { avatarId, artStyle } },
    create: { avatarId, artStyle, status: 'PENDING' },
    // cutoutUrl clears (the old cutout is invalid once we regenerate), but
    // turnaroundSheetUrl is deliberately KEPT: the X6 avatar-anchor contract
    // (avatar-sheets.ts) reads the last good sheet off a PENDING/FAILED
    // rendition so an AVATAR_STORY re-render never loses its identity anchor
    // mid-redraw. In-flight cutout patch jobs lose deterministically anyway —
    // their guarded writes require status READY (see the patch guards below).
    update: { status: 'PENDING', error: null, cutoutUrl: null },
  });

  try {
    // Promotion fast path: byte-copy the book's validated sheet and go READY
    // immediately — pre-X7 this flow was seconds-long and it must stay that
    // way (the parent just chose to keep a character they can already see).
    // The cutout generates AFTER, patched in with the same guarded write the
    // backfill uses, so the card silently upgrades portrait → cutout.
    if (job.data.copyFromSheetUrl) {
      const copied = await copySheetIntoAvatarFolder(avatarId, artStyle, job.data.copyFromSheetUrl);
      await prisma.avatarRendition.update({
        where: { id: rendition.id },
        data: {
          status: 'READY',
          turnaroundSheetUrl: copied,
          portraitUrl: portraitUrlFromSheet(copied),
          cutoutUrl: null,
          provider: 'copy',
          model: 'book-sheet',
          validatedAt: new Date(),
          error: null,
        },
      });
      await prisma.avatar.update({ where: { id: avatarId }, data: { status: 'READY' } });
      logger.info({ avatarId, artStyle }, 'Avatar rendition copied from book sheet');

      // The rendition is already READY — nothing in the garnish phase may
      // throw into the catch below and flip a usable card to FAILED.
      try {
        const promoIdentity = avatar.identity as unknown as AvatarIdentity | null;
        if (promoIdentity?.character) {
          const suffix = `_p${(job.id ?? 'x').replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`;
          const cutoutUrl = await generateAvatarCutout({
            openai,
            avatarId,
            artStyle,
            kind: avatar.kind,
            subject: cutoutSubjectForStyle(promoIdentity, artStyle),
            sheetUrl: copied,
            publicIdSuffix: suffix,
            logger,
          });
          if (cutoutUrl) {
            const written = await prisma.avatarRendition.updateMany({
              where: {
                id: rendition.id,
                status: 'READY',
                cutoutUrl: null,
                turnaroundSheetUrl: copied,
              },
              data: { cutoutUrl },
            });
            if (written.count === 0) await destroyCutoutVariants(cutoutUrl, logger);
          }
        }
      } catch (cutoutError) {
        logger.warn(
          { avatarId, artStyle, error: String(cutoutError) },
          'Promotion cutout patch skipped — card keeps the portrait',
        );
      }
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
        subjectDescription: job.data.subjectDescription,
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

    // A superseded SUFFIXED cutout (from an earlier promotion/backfill patch)
    // is no longer reachable from any stored URL — reap it. Compared on the
    // BASE id (trailing _t stripped): destroyCutoutVariants removes BOTH
    // variants behind a URL, so a same-base prior (e.g. a matte flip from
    // transparent to white across redraws) must be skipped or the reap would
    // delete the sibling this redraw just wrote and now serves.
    if (priorCutoutUrl) {
      const baseOf = (id: string) => (id.endsWith('_t') ? id.slice(0, -2) : id);
      const priorId = extractCloudinaryPublicId(priorCutoutUrl);
      const newId = cutoutUrl ? extractCloudinaryPublicId(cutoutUrl) : null;
      if (priorId && (!newId || baseOf(priorId) !== baseOf(newId))) {
        await destroyCutoutVariants(priorCutoutUrl, logger);
      }
    }
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
