import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { z } from 'zod';
import logger from '@/lib/logger';

// Zod schema for request body validation
const updatePageSchema = z.object({
  text: z.string(), // Allow empty string, can be handled by confirmation logic if needed
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookId: string, pageId: string }> }
) {
  const { bookId, pageId } = await params; 
  
  try {
    const { dbUser } = await getAuthenticatedUser();

    if (!bookId || !pageId) {
      return NextResponse.json({ error: 'Missing bookId or pageId parameter' }, { status: 400 });
    }

    // Parse and validate request body
    let requestBody;
    try {
      requestBody = await request.json();
    } catch (error) {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    // Validate the request body structure
    let validatedData;
    try {
      validatedData = updatePageSchema.parse(requestBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'Invalid request data', details: error.errors }, { status: 400 });
      }
      return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
    }

    const { text } = validatedData;

    // Verify user owns the book before proceeding - use database user ID
    const bookOwnerCheck = await prisma.book.findUnique({
      where: { id: bookId, userId: dbUser.id },
      select: { id: true },
    });

    if (!bookOwnerCheck) {
      return NextResponse.json({ error: 'Book not found or you do not have permission.' }, { status: 403 });
    }

    // Update the page text using updateMany to ensure the page belongs to the correct book
    const updateResult = await prisma.page.updateMany({
      where: {
        id: pageId,
        bookId: bookId, // Ensure the page belongs to this book
      },
      data: {
        text: text,
        textConfirmed: true, // Mark as confirmed when manually updated
        updatedAt: new Date(),
      },
    });

    // Check if any record was actually updated
    if (updateResult.count === 0) {
      // Check if the page exists at all to differentiate 404 vs 403
      const pageExists = await prisma.page.findUnique({ where: { id: pageId }, select: { id: true } });
      const status = pageExists ? 403 : 404;
      const message = pageExists ? 'Page does not belong to this book' : 'Page not found';
      return NextResponse.json({ error: message }, { status });
    }

    return NextResponse.json({ message: 'Page updated successfully' }, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error(`Error updating page ${pageId} in book ${bookId}:`, error);
    return NextResponse.json({ error: 'Failed to update page' }, { status: 500 });
  }
}

/**
 * DELETE /api/book/[bookId]/page/[pageId]
 * Deletes a page from a book and re-indexes remaining pages.
 *
 * Constraints:
 * - Cannot delete cover page (must change cover first)
 * - Book must have at least 2 pages after deletion
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ bookId: string; pageId: string }> }
) {
  const { bookId, pageId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId || !pageId) {
      logger.warn({ clerkId, dbUserId: dbUser.id }, 'API: Page deletion missing parameters');
      return NextResponse.json({ error: 'Missing bookId or pageId parameter' }, { status: 400 });
    }

    // Fetch book with all pages to validate constraints
    const book = await prisma.book.findUnique({
      where: { id: bookId, userId: dbUser.id },
      include: {
        pages: {
          select: { id: true, assetId: true, index: true },
          orderBy: { index: 'asc' },
        },
      },
    });

    if (!book) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId }, 'API: Deletion failed - Book not found or unauthorized');
      return NextResponse.json({ error: 'Book not found or you do not have permission.' }, { status: 403 });
    }

    // Find the page to delete
    const pageToDelete = book.pages.find((p) => p.id === pageId);
    if (!pageToDelete) {
      logger.warn({ clerkId, bookId, pageId }, 'API: Page not found in book');
      return NextResponse.json({ error: 'Page not found in this book.' }, { status: 404 });
    }

    // CONSTRAINT 1: Cannot delete cover page
    if (pageToDelete.assetId === book.coverAssetId) {
      logger.warn({ clerkId, bookId, pageId }, 'API: Cannot delete cover page');
      return NextResponse.json(
        { error: 'Cannot delete the cover photo. Please select a different cover first.' },
        { status: 400 }
      );
    }

    // CONSTRAINT 2: Must have at least 2 pages after deletion
    if (book.pages.length <= 2) {
      logger.warn({ clerkId, bookId, pageId, currentCount: book.pages.length }, 'API: Cannot delete - minimum pages required');
      return NextResponse.json(
        { error: 'Cannot delete. Your book must have at least 2 photos.' },
        { status: 400 }
      );
    }

    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      logger.info({ clerkId, dbUserId: dbUser.id, bookId, pageId }, 'API: Starting page deletion transaction');

      // Delete the page
      await tx.page.delete({
        where: { id: pageId },
      });

      // Re-index remaining pages sequentially
      const remainingPages = book.pages
        .filter((p) => p.id !== pageId)
        .sort((a, b) => a.index - b.index);

      for (let i = 0; i < remainingPages.length; i++) {
        await tx.page.update({
          where: { id: remainingPages[i].id },
          data: {
            index: i,
            pageNumber: i + 1,
            isTitlePage: i === 0,
          },
        });
      }

      // Update book pageLength
      await tx.book.update({
        where: { id: bookId },
        data: { pageLength: remainingPages.length },
      });

      logger.info(
        { clerkId, dbUserId: dbUser.id, bookId, pageId, remainingCount: remainingPages.length },
        'API: Page deletion transaction committed'
      );
    });

    return NextResponse.json({ message: 'Page deleted successfully' }, { status: 200 });
  } catch (error) {
    // Handle authentication errors
    if (
      error instanceof Error &&
      (error.message.includes('not authenticated') ||
        error.message.includes('ID mismatch') ||
        error.message.includes('primary email not found'))
    ) {
      logger.warn('API: Page deletion attempt without authentication');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({ bookId, pageId, error }, 'API: Error during page deletion');
    return NextResponse.json({ error: 'Failed to delete page' }, { status: 500 });
  }
} 