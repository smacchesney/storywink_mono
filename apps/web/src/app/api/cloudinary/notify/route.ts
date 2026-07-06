import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { PageType } from '@prisma/client';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { convertHeicToJpeg } from '@storywink/shared/utils';
import { BOOK_CONSTRAINTS } from '@storywink/shared/constants';
import { QueueName, getQueue } from '@/lib/queue/index';

// Exactly the payload uploadPhotos.ts sends per asset (CloudinaryAssetPayload).
// Unknown keys are stripped; anything structurally off is a 400, not a crash
// or a poisoned Asset row.
const notifyAssetSchema = z.object({
  publicId: z.string().min(1).max(512),
  url: z.string().url().max(2048),
  thumbnailUrl: z.string().url().max(2048).nullish(),
  format: z.string().max(32).nullish(),
  bytes: z.number().int().nonnegative(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const notifyBodySchema = z.object({
  assets: z.array(notifyAssetSchema).min(1).max(BOOK_CONSTRAINTS.MAX_PHOTOS),
  bookId: z.string().cuid().nullish(),
});

// This endpoint is called after successful Cloudinary uploads to create database records
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const { dbUser, clerkId } = await getAuthenticatedUser();
    logger.info({ clerkUserId: clerkId, dbUserId: dbUser.id }, "Cloudinary notify endpoint called");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const parsed = notifyBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { assets, bookId } = parsed.data;

    // Ownership pin: /api/upload/signature signs every real upload into
    // `user_<dbUser.id>/uploads`, so a legitimate publicId always lives in
    // the caller's own folder. Anything else (another user's folder, shared
    // mascot/demo ids) is a forgery — and since the deletion pipeline deletes
    // Asset.publicId verbatim, a poisoned row here would become a
    // cross-tenant Cloudinary deletion once ASSET_CLEANUP_ENFORCE is on.
    const ownedPrefix = `user_${dbUser.id}/`;
    const foreign = assets.find((a) => !a.publicId.startsWith(ownedPrefix));
    if (foreign) {
      logger.warn(
        { dbUserId: dbUser.id, publicId: foreign.publicId },
        'Cloudinary notify rejected: publicId outside caller folder',
      );
      return NextResponse.json({ error: 'Invalid asset ownership' }, { status: 400 });
    }

    console.log(`>>> DEBUG: Cloudinary notify - dbUserId: ${dbUser.id}, assetCount: ${assets.length}, bookId: ${bookId || 'none'}`);

    const createdAssets = [];
    let bookPageCount = 0;

    // If bookId provided, verify user owns the book and get page count
    let bookStatus: string | null = null;
    if (bookId) {
      const book = await prisma.book.findUnique({
        where: { id: bookId, userId: dbUser.id },
        select: { status: true, _count: { select: { pages: true } } }
      });
      if (!book) {
        return NextResponse.json({ error: 'Book not found or permission denied' }, { status: 404 });
      }
      bookPageCount = book._count.pages;
      bookStatus = book.status;
    }

    // Create database records for each uploaded asset
    for (const asset of assets) {
      try {
        // iPhones shoot HEIC by default. Cloudinary stores the original but can
        // transcode on delivery, so we persist JPEG-deliverable URLs. Vision
        // APIs and <img> tags can't render HEIC directly; convertHeicToJpeg
        // rewrites .heic URLs with an f_jpg transform and passes others through.
        const isHeic =
          asset.format?.toLowerCase() === 'heic' ||
          asset.format?.toLowerCase() === 'heif' ||
          asset.url?.toLowerCase().includes('.heic') ||
          asset.url?.toLowerCase().includes('.heif');
        const storedUrl = isHeic ? convertHeicToJpeg(asset.url) : asset.url;
        const storedThumbnailUrl = isHeic ? convertHeicToJpeg(asset.thumbnailUrl) : asset.thumbnailUrl;
        const storedFileType = isHeic ? 'image/jpeg' : `image/${asset.format}`;

        const createdData = await prisma.$transaction(async (tx) => {
          // Create Asset record
          const newAsset = await tx.asset.create({
            data: {
              userId: dbUser.id,
              publicId: asset.publicId,
              url: storedUrl,
              thumbnailUrl: storedThumbnailUrl,
              fileType: storedFileType, // JPEG for HEIC uploads (delivered as JPEG)
              size: asset.bytes,
            },
          });

          console.log(`>>> DEBUG: Asset created - id: ${newAsset.id}, userId: ${dbUser.id}, publicId: ${asset.publicId}`);
          logger.info({ assetId: newAsset.id, publicId: asset.publicId }, "Asset created in database");

          // If bookId was provided, create Page record
          if (bookId) {
            await tx.page.create({
              data: {
                bookId: bookId,
                assetId: newAsset.id,
                pageNumber: bookPageCount + 1,
                index: bookPageCount,
                originalImageUrl: newAsset.thumbnailUrl || newAsset.url,
                pageType: PageType.SINGLE,
                isTitlePage: false,
              }
            });
            bookPageCount++;
            logger.info({ bookId, assetId: newAsset.id }, "Page created for book");
          }

          return {
            id: newAsset.id,
            thumbnailUrl: newAsset.thumbnailUrl,
            url: newAsset.url,
          };
        });

        createdAssets.push(createdData);
      } catch (error) {
        logger.error({
          asset: asset.publicId,
          err: error,
          errorMessage: error instanceof Error ? error.message : String(error)
        }, "Failed to create database record for asset");
        // Continue with other assets even if one fails
      }
    }

    logger.info({ count: createdAssets.length }, "Assets created successfully");

    // Photos added to a DRAFT book change what the perception pass saw —
    // refresh the story brief/questions/identity for the new set. Non-fatal.
    if (bookId && bookStatus === 'DRAFT' && createdAssets.length > 0) {
      try {
        await getQueue(QueueName.PhotoAnalysis).add(
          `analyze-photos-${bookId}`,
          { bookId, userId: dbUser.id, refresh: true },
          {
            attempts: 2,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 500 },
          }
        );
      } catch (queueError) {
        logger.error({ bookId, error: queueError }, 'Failed to enqueue perception refresh (non-fatal)');
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        assets: createdAssets,
        count: createdAssets.length
      }
    }, { status: 201 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      logger.warn('Cloudinary notify attempt without authentication');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({
      err: error,
      errorMessage: error instanceof Error ? error.message : String(error)
    }, 'Cloudinary notify endpoint error');
    return NextResponse.json({ 
      error: 'Failed to process uploaded assets',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}