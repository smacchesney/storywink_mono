import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { z } from 'zod';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { BookStatus, PageType } from '@prisma/client';

// Zod schema for request body validation
const createBookSchema = z.object({
  assetIds: z.array(z.string().cuid()).min(1, { message: 'At least one asset ID is required.' }),
});

export async function POST(req: NextRequest) {
  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    let validatedData;
    try {
      const body = await req.json();
      validatedData = createBookSchema.parse(body);
      logger.info({ clerkId, dbUserId: dbUser.id, assetCount: validatedData.assetIds.length }, 'API: Validated book creation request.');
    } catch (error) {
      logger.warn({ clerkId, dbUserId: dbUser.id, error }, 'API: Invalid book creation request body.');
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'Invalid request body', details: error.errors }, { status: 400 });
      }
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { assetIds } = validatedData;

    // Use a transaction to ensure atomicity
    const newBook = await prisma.$transaction(async (tx) => {
      logger.info({ clerkId, dbUserId: dbUser.id }, 'API: Starting book creation transaction.');

      // Fetch Assets to get URLs - use database user ID, not Clerk ID
      const assets = await tx.asset.findMany({
        where: {
          id: { in: assetIds },
          userId: dbUser.id, // Use database user ID instead of Clerk ID
        },
        select: {
          id: true,
          url: true,
          thumbnailUrl: true,
        },
      });
      
      // Create a map for easy lookup
      const assetMap = new Map(assets.map(a => [a.id, a]));

      // Check if all requested assetIds were found and belong to the user
      if (assets.length !== assetIds.length) {
          const foundIds = new Set(assets.map(a => a.id));
          const missingIds = assetIds.filter(id => !foundIds.has(id));
          logger.error({ clerkId, dbUserId: dbUser.id, bookId: '(pending)', missingIds }, 'API: Some assets not found or permission denied during book creation.');
          throw new Error(`Assets not found or permission denied for IDs: ${missingIds.join(', ')}`);
      }
      logger.info({ clerkId, dbUserId: dbUser.id, assetCount: assets.length }, 'API: Fetched asset URLs within transaction.');

      // 1. Create the Book record - use database user ID
      const book = await tx.book.create({
        data: {
          userId: dbUser.id, // Use database user ID instead of Clerk ID
          title: '', // Start with empty title as per new requirements
          childName: '', // Start with empty child name as per new requirements
          status: BookStatus.DRAFT,
          pageLength: assetIds.length, // Set page length based on provided assets
          // Other fields like artStyle will be set later in the editor
          isWinkifyEnabled: true, // Default to enabled
        },
      });
      logger.info({ clerkId, dbUserId: dbUser.id, bookId: book.id }, 'API: Book record created within transaction.');

      // 2. Prepare Page records data - NOW WITH IMAGE URL
      const pagesData = assetIds.map((assetId, index) => {
          const asset = assetMap.get(assetId);
          if (!asset) {
              // This shouldn't happen due to the check above, but belts and braces
              throw new Error(`Internal error: Asset data missing for ID ${assetId}`);
          }
          return {
            bookId: book.id,
            pageNumber: index + 1, 
            index: index,         
            assetId: assetId,
            originalImageUrl: asset.thumbnailUrl || asset.url, // <-- Use fetched URL (prefer thumbnail)
            pageType: PageType.SINGLE, 
            isTitlePage: index === 0, 
          };
      });

      // 3. Create Page records
      await tx.page.createMany({ data: pagesData });
      logger.info({ clerkId, dbUserId: dbUser.id, bookId: book.id, pageCount: pagesData.length }, 'API: Page records created within transaction.');

      logger.info({ clerkId, dbUserId: dbUser.id, bookId: book.id }, 'API: Book creation transaction committed.');
      return book; // Return the created book
    });

    return NextResponse.json({ bookId: newBook.id }, { status: 201 }); // 201 Created

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      logger.warn('API: Book creation attempt without authentication.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({ error }, 'API: Error during book creation transaction.');
    // Specific error handling (e.g., foreign key constraint if assetId doesn't exist)
    if (error instanceof Error && error.message.includes('Foreign key constraint failed')) {
        return NextResponse.json({ error: 'One or more provided asset IDs do not exist or belong to another user.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to create book draft' }, { status: 500 });
  }
} 