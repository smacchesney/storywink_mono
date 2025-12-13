import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { generateLuluCover } from '@/lib/pdf/generateLuluCover';
import { uploadPdfToDropbox } from '@/lib/dropbox';
import { Book, Page } from '@prisma/client';

// Define the expected Book type with Pages for the PDF generator
type BookWithPages = Book & { pages: Page[] };

/**
 * Generates cover spread PDF for Lulu print-on-demand and uploads to Dropbox.
 * Creates a spread with back cover (coral branding) and front cover (title page).
 * Returns a publicly accessible URL that Lulu API can fetch.
 *
 * POST /api/book/[bookId]/export/lulu-cover
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    logger.info({ clerkId, dbUserId: dbUser.id, bookId }, 'Lulu cover PDF export request received.');

    // Fetch the book data with pages
    const bookData = await prisma.book.findUnique({
      where: {
        id: bookId,
        userId: dbUser.id,
      },
      include: {
        pages: {
          orderBy: { index: 'asc' },
          select: {
            id: true,
            pageNumber: true,
            index: true,
            assetId: true,
            text: true,
            generatedImageUrl: true,
            originalImageUrl: true,
            textConfirmed: true,
            pageType: true,
            isTitlePage: true,
            createdAt: true,
            updatedAt: true,
            bookId: true,
            moderationStatus: true,
            moderationReason: true,
            illustrationNotes: true,
          }
        },
      },
    });

    if (!bookData) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId }, 'Book not found or access denied for Lulu cover export.');
      return NextResponse.json({ error: 'Book not found or access denied' }, { status: 404 });
    }

    // Check book status - should be COMPLETED or PARTIAL for printing
    if (bookData.status !== 'COMPLETED' && bookData.status !== 'PARTIAL') {
      return NextResponse.json(
        { error: `Book is not ready for printing. Current status: ${bookData.status}` },
        { status: 400 }
      );
    }

    // Generate the cover PDF buffer
    logger.info({ bookId }, 'Generating cover PDF for Lulu...');
    const pdfBuffer = await generateLuluCover(bookData as BookWithPages);

    // Upload to Dropbox with public shared link (avoids Cloudinary 10MB limit)
    logger.info({ bookId }, 'Uploading cover PDF to Dropbox...');
    const uploadResult = await uploadPdfToDropbox(pdfBuffer, bookId, 'cover.pdf');

    logger.info({ bookId, dropboxPath: uploadResult.path }, 'Cover PDF uploaded to Dropbox.');

    return NextResponse.json({
      success: true,
      url: uploadResult.url,
      dropboxPath: uploadResult.path,
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
    }, 'Error generating Lulu cover PDF.');
    return NextResponse.json({ error: 'Failed to generate cover PDF' }, { status: 500 });
  }
}
