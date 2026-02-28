import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { generateBookPdf } from '@/lib/pdf/generateBookPdf';
import { uploadPdfToDropbox } from '@/lib/dropbox';
import { Book, Page } from '@prisma/client';
import { isTitlePage } from '@storywink/shared/utils';

// Define the expected Book type with Pages for the PDF generator
type BookWithPages = Book & { pages: Page[] };

/**
 * Generates interior PDF for Lulu print-on-demand and uploads to Dropbox.
 * Returns a publicly accessible URL that Lulu API can fetch.
 *
 * POST /api/book/[bookId]/export/lulu-interior
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

    logger.info({ clerkId, dbUserId: dbUser.id, bookId }, 'Lulu interior PDF export request received.');

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
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId }, 'Book not found or access denied for Lulu export.');
      return NextResponse.json({ error: 'Book not found or access denied' }, { status: 404 });
    }

    // Check book status - should be COMPLETED or PARTIAL for printing
    if (bookData.status !== 'COMPLETED' && bookData.status !== 'PARTIAL') {
      return NextResponse.json(
        { error: `Book is not ready for printing. Current status: ${bookData.status}` },
        { status: 400 }
      );
    }

    // Filter out title page - Lulu interior should only contain story pages
    // The title page is used for the cover (separate PDF), not the interior
    const storyPages = bookData.pages.filter(
      page => !isTitlePage(page.assetId, bookData.coverAssetId)
    );

    logger.info({
      bookId,
      totalPages: bookData.pages.length,
      storyPages: storyPages.length,
      coverAssetId: bookData.coverAssetId,
    }, 'Filtered pages for Lulu interior (excluding title page)');

    // Validate we have story pages to print
    if (storyPages.length === 0) {
      logger.warn({ bookId }, 'No story pages found for interior PDF');
      return NextResponse.json(
        { error: 'No story pages found. Book must have at least one story page for interior PDF.' },
        { status: 400 }
      );
    }

    // Calculate interleaved page count: 1 dedication page + each story page becomes 2 PDF pages (text + illustration)
    // The PDF generator handles padding to multiple of 4 for Lulu saddle stitch
    const interiorPdfPageCount = storyPages.length * 2 + 1; // +1 for dedication page
    const paddedPageCount = interiorPdfPageCount % 4 === 0
      ? interiorPdfPageCount
      : interiorPdfPageCount + (4 - (interiorPdfPageCount % 4));

    logger.info({
      bookId,
      storyPages: storyPages.length,
      interiorPdfPages: interiorPdfPageCount,
      paddedPages: paddedPageCount,
    }, 'Generating interleaved interior PDF for Lulu...');

    // Validate Lulu page count constraints (min 4, max 48 for saddle stitch)
    if (paddedPageCount > 48) {
      return NextResponse.json(
        { error: `Too many pages for saddle stitch binding (${paddedPageCount} pages, max 48). Reduce the number of photos.` },
        { status: 400 }
      );
    }

    // Generate the interior PDF buffer (interleaved text + illustration pages)
    const pdfBuffer = await generateBookPdf({
      ...bookData,
      pages: storyPages,
    } as BookWithPages);

    // Upload to Dropbox with public shared link (avoids Cloudinary 10MB limit)
    logger.info({ bookId }, 'Uploading interior PDF to Dropbox...');
    const uploadResult = await uploadPdfToDropbox(pdfBuffer, bookId, 'interior.pdf');

    logger.info({ bookId, dropboxPath: uploadResult.path }, 'Interior PDF uploaded to Dropbox.');

    return NextResponse.json({
      success: true,
      url: uploadResult.url,
      dropboxPath: uploadResult.path,
      pageCount: paddedPageCount,  // Return padded PDF page count
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
    }, 'Error generating Lulu interior PDF.');
    return NextResponse.json({ error: 'Failed to generate interior PDF' }, { status: 500 });
  }
}
