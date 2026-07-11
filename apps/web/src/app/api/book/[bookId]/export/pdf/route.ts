import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { generateBookPdf } from '@storywink/pdf';
import { isTitlePage } from '@storywink/shared/utils';
import { Book, Page } from '@prisma/client';
import { loadWebPdfFonts } from '../pdfFonts';
import { optimizeForScreen, pdfContentDisposition } from '@/lib/pdf-export';

// Define the expected Book type with Pages for the PDF generator
type BookWithPages = Book & { pages: (Page & { asset?: { url: string } | null })[] };

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
            asset: { select: { url: true } },
          }
        },
      },
    });

    if (!bookData) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId }, "Book not found or user does not have permission for PDF export.");
      return NextResponse.json({ error: 'Book not found or access denied' }, { status: 404 });
    }

    // Find cover page for the title page illustration
    const coverPage = bookData.pages.find(
      page => isTitlePage(page.assetId, bookData.coverAssetId)
    );
    // Use coverImageUrl (dedicated cover illustration) if available, otherwise fall back to page illustration
    const titlePageForPdf = coverPage ? {
      ...coverPage,
      generatedImageUrl: bookData.coverImageUrl || coverPage.generatedImageUrl,
    } : undefined;

    // 2. Generate the PDF buffer (user mode: title → dedication → ALL stories → back cover).
    // optimizeForScreen swaps Cloudinary's f_auto (WebP → ~9MB lossless flate
    // per page in the PDF) for JPEG passthrough at illustrator-native 2048px.
    const startedAt = Date.now();
    const pdfBuffer = await generateBookPdf(
      bookData as BookWithPages,
      {
        fonts: loadWebPdfFonts(),
        titlePage: titlePageForPdf as Page | undefined,
        includeBackCover: true,
        padToFour: false,
        includeCollage: process.env.COLLAGE_PAGES_ENABLED === 'true',
        imageUrlTransform: optimizeForScreen,
        logger,
      }
    );

    logger.info(
      { bookId, durationMs: Date.now() - startedAt, bufferSize: pdfBuffer.length },
      'User PDF export generated.'
    );

    // 3. Send the PDF as response
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': pdfContentDisposition(bookData.title),
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