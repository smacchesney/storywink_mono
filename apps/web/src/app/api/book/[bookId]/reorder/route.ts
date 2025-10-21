import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { z } from 'zod';
import logger from '@/lib/logger';

// Zod schema for request body validation
const reorderPagesSchema = z.object({
  pages: z.array(
    z.object({
      pageId: z.string().cuid(),
      index: z.number().min(0), // New index position (0-based)
    })
  ).min(1, { message: 'At least one page required for reordering.' }),
});

// Define the context type for the route
type Context = { params: Promise<{ bookId: string }> };

export async function POST(
  req: NextRequest,
  { params }: Context
) {
  const { bookId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId) {
      logger.warn({ clerkId, dbUserId: dbUser.id }, 'API: Page reorder attempt missing bookId.');
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    let validatedData;
    try {
      const body = await req.json();
      validatedData = reorderPagesSchema.parse(body);
      logger.info({ clerkId, dbUserId: dbUser.id, bookId, pageCount: validatedData.pages.length }, 'API: Validated page reorder request.');
    } catch (error) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId, error }, 'API: Invalid page reorder request body.');
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'Invalid request body', details: error.errors }, { status: 400 });
      }
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { pages } = validatedData;

    // Verify user owns the book before proceeding
    const bookOwnerCheck = await prisma.book.findUnique({
      where: { id: bookId, userId: dbUser.id },
      select: { id: true }, // Select minimal field
    });

    if (!bookOwnerCheck) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId }, 'API: Reorder attempt failed - Book not found or user does not own it.');
      return NextResponse.json({ error: 'Book not found or you do not have permission.' }, { status: 403 }); // Forbidden or 404
    }

    // Fetch current page state before reordering
    const currentPages = await prisma.page.findMany({
      where: { bookId },
      select: {
        id: true,
        index: true,
        pageNumber: true,
        isTitlePage: true,
        assetId: true,
      },
      orderBy: { index: 'asc' }
    });

    logger.info({
      clerkId,
      dbUserId: dbUser.id,
      bookId,
      beforeState: currentPages.map(p => ({
        id: p.id,
        index: p.index,
        pageNumber: p.pageNumber,
        isTitlePage: p.isTitlePage
      }))
    }, 'API: Page state before reorder');

    // Use a transaction to update all page indices atomically
    await prisma.$transaction(async (tx) => {
      logger.info({ clerkId, dbUserId: dbUser.id, bookId }, 'API: Starting page reorder transaction.');
      
      
      const updatePromises = pages.map(page => 
        tx.page.updateMany({ // Use updateMany to ensure page belongs to the correct book
          where: {
            id: page.pageId,
            bookId: bookId, // Ensure the page belongs to this book
          },
          data: {
            index: page.index,
            pageNumber: page.index + 1,
            // Update isTitlePage based on whether this page is at index 0
            isTitlePage: page.index === 0,
          },
        })
      );
      const results = await Promise.all(updatePromises);
      
      // Optional: Check results to ensure all updates affected 1 row
      const failedUpdates = results.filter(result => result.count !== 1);
      if (failedUpdates.length > 0) {
         logger.error({ clerkId, dbUserId: dbUser.id, bookId, failedUpdates }, 'API: Some pages failed to update during reorder transaction.');
         // Rollback happens automatically due to the error
         throw new Error('Failed to update one or more pages during reorder. Mismatched page IDs or book association?');
      }

      // Fetch and log new state
      const afterPages = await tx.page.findMany({
        where: { bookId },
        select: {
          id: true,
          index: true,
          pageNumber: true,
          isTitlePage: true,
        },
        orderBy: { index: 'asc' }
      });

      // Detect which pages changed isTitlePage status
      const titlePageChanges = currentPages
        .map(before => {
          const after = afterPages.find(a => a.id === before.id);
          if (after && before.isTitlePage !== after.isTitlePage) {
            return {
              pageId: before.id,
              wasTitlePage: before.isTitlePage,
              nowTitlePage: after.isTitlePage
            };
          }
          return null;
        })
        .filter(Boolean);

      logger.info({
        clerkId,
        dbUserId: dbUser.id,
        bookId,
        afterState: afterPages.map(p => ({
          id: p.id,
          index: p.index,
          pageNumber: p.pageNumber,
          isTitlePage: p.isTitlePage
        })),
        titlePageChanges: titlePageChanges.length > 0 ? titlePageChanges : 'none'
      }, 'API: Page state after reorder');

      logger.info({ clerkId, dbUserId: dbUser.id, bookId, updatedCount: results.length }, 'API: Page reorder transaction committed.');
    });

    return NextResponse.json({ message: 'Page order updated successfully' }, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      logger.warn('API: Page reorder attempt without authentication.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({ bookId, error }, 'API: Error during page reorder.');
    return NextResponse.json({ error: 'Failed to reorder pages' }, { status: 500 });
  }
} 