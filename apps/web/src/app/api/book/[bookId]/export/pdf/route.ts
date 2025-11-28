import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { generateBookPdf } from '@/lib/pdf/generateBookPdf';
import { Book, Page } from '@prisma/client';

// Define the expected Book type with Pages for the PDF generator
type BookWithPages = Book & { pages: Page[] };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    logger.info({ clerkId, dbUserId: dbUser.id, bookId }, "PDF export request received.");

    // 1. Fetch the full book data, including pages with text and generated URLs
    const bookData = await prisma.book.findUnique({
      where: {
        id: bookId,
        userId: dbUser.id, // Use database user ID for ownership check
      },
      include: {
        pages: {
          orderBy: { index: 'asc' },
          // Select all fields needed by generatePageHtml
          select: {
            id: true,
            pageNumber: true,
            text: true,
            generatedImageUrl: true,
            // Include other fields if needed by generatePageHtml
            originalImageUrl: true, // Might be useful for context? 
            textConfirmed: true,
            pageType: true,
            createdAt: true,
            updatedAt: true,
            bookId: true, // Need bookId if Page type is strictly checked
            moderationStatus: true, // Include new fields
            moderationReason: true,
          }
        },
      },
    });

    if (!bookData) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId }, "Book not found or user does not have permission for PDF export.");
      return NextResponse.json({ error: 'Book not found or access denied' }, { status: 404 });
    }

    // Basic check: Ensure the book is completed before allowing export?
    // if (bookData.status !== 'COMPLETED') {
    //   return NextResponse.json({ error: 'Book is not yet completed' }, { status: 400 });
    // }

    // 2. Generate the PDF buffer
    const pdfBuffer = await generateBookPdf(bookData as BookWithPages);

    // 3. Send the PDF as response
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${bookData.title || 'book'}.pdf"`,
      },
    });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error({
      bookId,
      errorMessage,
      errorStack
    }, "Error generating PDF.");
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
} 