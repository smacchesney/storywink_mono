import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { PageType } from '@prisma/client';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { convertHeicToJpeg } from '@storywink/shared/utils';

// This endpoint is called after successful Cloudinary uploads to create database records
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const { dbUser, clerkId } = await getAuthenticatedUser();
    logger.info({ clerkUserId: clerkId, dbUserId: dbUser.id }, "Cloudinary notify endpoint called");

    const body = await request.json();
    const { assets, bookId } = body;
    console.log(`>>> DEBUG: Cloudinary notify - dbUserId: ${dbUser.id}, assetCount: ${assets?.length || 0}, bookId: ${bookId || 'none'}`);

    if (!assets || !Array.isArray(assets)) {
      return NextResponse.json({ error: 'No assets provided' }, { status: 400 });
    }

    const createdAssets = [];
    let bookPageCount = 0;

    // If bookId provided, verify user owns the book and get page count
    if (bookId) {
      const book = await prisma.book.findUnique({
        where: { id: bookId, userId: dbUser.id },
        select: { _count: { select: { pages: true } } }
      });
      if (!book) {
        return NextResponse.json({ error: 'Book not found or permission denied' }, { status: 404 });
      }
      bookPageCount = book._count.pages;
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