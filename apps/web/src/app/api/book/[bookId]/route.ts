import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { z } from 'zod'; // Import Zod
import logger from '@/lib/logger'; // Import logger

// Zod schema for validating PATCH request body
const updateBookSchema = z.object({
  artStyle: z.string().nullable().optional(), // Allow null or undefined
  title: z.string().min(1, { message: 'Title cannot be empty.' }).optional(),
  coverAssetId: z.string().cuid().nullable().optional(), // For cover changes
}).strict(); // Ensure no extra fields are passed

type RouteContext = { params: Promise<{ bookId: string }> };

export async function GET(
  _req: NextRequest, // Changed from request: Request
  { params }: RouteContext // Applied RouteContext
) {
  const { bookId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    console.log(`Attempting to fetch book ${bookId} for user ${clerkId}`);
    const book = await prisma.book.findUnique({
      where: {
        id: bookId,
        userId: dbUser.id, // Use database user ID for ownership check
      },
      include: {
        pages: {
          orderBy: {
            index: 'asc',
          },
          include: {
            asset: {
              select: {
                id: true,
                url: true,
                thumbnailUrl: true,
              }
            }
          }
        },
      },
    });

    if (!book) {
      console.log(`Book ${bookId} not found or user ${clerkId} does not have permission.`);
      return NextResponse.json({ error: 'Book not found or you do not have permission to view it' }, { status: 404 });
    }

    console.log(`Successfully fetched book ${bookId} with ${book.pages.length} pages including assets.`);
    // You might want to conditionally return data based on status if needed
    // For preview, we generally want the data regardless of status to show progress/errors
    return NextResponse.json(book, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error(`Error fetching book ${bookId}:`, error);
    return NextResponse.json({ error: 'Failed to fetch book data' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest, // Use NextRequest to easily get JSON body
  { params }: RouteContext // Applied RouteContext
) {
  const { bookId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId) {
      logger.warn({ clerkId, dbUserId: dbUser.id }, 'API: Book update attempt missing bookId.');
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    let validatedData;
    try {
      const body = await req.json();
      validatedData = updateBookSchema.parse(body);
      // Check if at least one field is being updated
      if (Object.keys(validatedData).length === 0) {
        return NextResponse.json({ error: 'No update data provided' }, { status: 400 });
      }
      logger.info({ clerkId, dbUserId: dbUser.id, bookId, data: validatedData }, 'API: Validated book update request.');
    } catch (error) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId, error }, 'API: Invalid book update request body.');
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'Invalid request body', details: error.errors }, { status: 400 });
      }
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // If coverAssetId is being changed, log before/after
    if (validatedData.coverAssetId !== undefined) {
      const currentBook = await prisma.book.findUnique({
        where: { id: bookId },
        select: {
          coverAssetId: true,
          pages: {
            where: { isTitlePage: true },
            select: { id: true, assetId: true }
          }
        }
      });

      logger.info({
        clerkId,
        dbUserId: dbUser.id,
        bookId,
        oldCoverAssetId: currentBook?.coverAssetId,
        newCoverAssetId: validatedData.coverAssetId,
        currentTitlePages: currentBook?.pages.map(p => p.id),
        willAffectPages: currentBook?.pages.filter(
          p => p.assetId === validatedData.coverAssetId ||
               p.assetId === currentBook.coverAssetId
        ).length
      }, 'API: Cover asset is being changed');
    }

    // Use updateMany to ensure user owns the book AND the book exists
    const updateResult = await prisma.book.updateMany({
      where: {
        id: bookId,
        userId: dbUser.id, // Use database user ID for ownership check
      },
      data: {
        ...validatedData,
        updatedAt: new Date(), // Manually update timestamp
      },
    });

    // Check if any record was actually updated
    if (updateResult.count === 0) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId }, 'API: Book update failed - Book not found or user does not own it.');
      // Check if the book exists at all to differentiate 404 vs 403
      const bookExists = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true } });
      const status = bookExists ? 403 : 404;
      const message = bookExists ? 'Permission denied' : 'Book not found';
      return NextResponse.json({ error: message }, { status });
    }

    logger.info({ clerkId, dbUserId: dbUser.id, bookId }, 'API: Book updated successfully.');
    // Optionally fetch and return the updated book data
    // const updatedBook = await prisma.book.findUnique({ where: { id: bookId } });
    // return NextResponse.json(updatedBook, { status: 200 });
    return NextResponse.json({ message: 'Book updated successfully' }, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      logger.warn('API: Book update attempt without authentication.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({ bookId, error }, 'API: Error updating book.');
    // Handle potential Prisma errors, e.g., unique constraint violations if applicable
    return NextResponse.json({ error: 'Failed to update book' }, { status: 500 });
  }
} 