import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { BookStatus } from '@prisma/client';
import { z } from 'zod';
import logger from '@/lib/logger';

const replacePhotoSchema = z.object({
  assetId: z.string().cuid({ message: 'Valid asset ID is required' }),
});

/**
 * POST /api/book/[bookId]/page/[pageId]/replace-photo
 * Replaces the photo on a FLAGGED page, resetting it for re-generation.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookId: string; pageId: string }> }
) {
  const { bookId, pageId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    const { assetId } = replacePhotoSchema.parse(body);

    // Verify book ownership and status
    const book = await prisma.book.findUnique({
      where: { id: bookId, userId: dbUser.id },
      select: { id: true, status: true },
    });

    if (!book) {
      return NextResponse.json({ error: 'Book not found or access denied.' }, { status: 404 });
    }

    if (book.status !== BookStatus.PARTIAL) {
      return NextResponse.json(
        { error: `Photo replacement is only available for books with status PARTIAL (current: ${book.status})` },
        { status: 409 }
      );
    }

    // Verify the page exists, belongs to this book, and is FLAGGED
    const page = await prisma.page.findFirst({
      where: { id: pageId, bookId },
      select: { id: true, moderationStatus: true, generatedImageUrl: true },
    });

    if (!page) {
      return NextResponse.json({ error: 'Page not found in this book.' }, { status: 404 });
    }

    // Allow replacement on pages that need work (FLAGGED or PENDING without illustration)
    const canReplace = page.moderationStatus === 'FLAGGED' ||
      (page.moderationStatus === 'PENDING' && !page.generatedImageUrl);
    if (!canReplace) {
      return NextResponse.json(
        { error: 'This page already has a completed illustration.' },
        { status: 400 }
      );
    }

    // Verify the new asset exists and belongs to this user
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, userId: dbUser.id },
      select: { id: true, url: true, thumbnailUrl: true },
    });

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found or access denied.' }, { status: 404 });
    }

    // Update the page with the new asset and reset generation state
    const updatedPage = await prisma.page.update({
      where: { id: pageId },
      data: {
        assetId: asset.id,
        originalImageUrl: asset.url,
        generatedImageUrl: null,
        moderationStatus: 'PENDING',
        moderationReason: null,
        text: null,
        textConfirmed: false,
        illustrationNotes: null,
      },
      select: {
        id: true,
        pageNumber: true,
        assetId: true,
        originalImageUrl: true,
        moderationStatus: true,
      },
    });

    logger.info(
      { clerkId, dbUserId: dbUser.id, bookId, pageId, newAssetId: assetId },
      'API: Photo replaced on FLAGGED page'
    );

    return NextResponse.json({ page: updatedPage }, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request data', details: error.errors }, { status: 400 });
    }

    if (
      error instanceof Error &&
      (error.message.includes('not authenticated') ||
        error.message.includes('ID mismatch') ||
        error.message.includes('primary email not found'))
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({ bookId, pageId, error }, 'API: Error replacing photo');
    return NextResponse.json({ error: 'Failed to replace photo' }, { status: 500 });
  }
}
