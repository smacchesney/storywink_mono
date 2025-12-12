import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { generateBookPdf } from '@/lib/pdf/generateBookPdf';
import cloudinary from '@/lib/cloudinary';
import { Book, Page } from '@prisma/client';

// Define the expected Book type with Pages for the PDF generator
type BookWithPages = Book & { pages: Page[] };

/**
 * Generates interior PDF for Lulu print-on-demand and uploads to Cloudinary.
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

    // Generate the interior PDF buffer (now with Lulu 8.5x8.5 specs)
    logger.info({ bookId }, 'Generating interior PDF for Lulu...');
    const pdfBuffer = await generateBookPdf(bookData as BookWithPages);

    // Upload to Cloudinary with public access
    logger.info({ bookId }, 'Uploading interior PDF to Cloudinary...');
    const uploadResult = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `storywink/${bookId}/print`,
          public_id: 'interior',
          resource_type: 'raw', // PDF is raw resource type
          overwrite: true,
          format: 'pdf',
          tags: [`book:${bookId}`, 'lulu-interior', 'print'],
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            resolve({ secure_url: result.secure_url, public_id: result.public_id });
          } else {
            reject(new Error('No result from Cloudinary upload'));
          }
        }
      );
      uploadStream.end(pdfBuffer);
    });

    logger.info({ bookId, publicId: uploadResult.public_id }, 'Interior PDF uploaded to Cloudinary.');

    return NextResponse.json({
      success: true,
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      pageCount: bookData.pages.length,
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
