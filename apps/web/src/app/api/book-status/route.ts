import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { dbUser } = await getAuthenticatedUser();
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('bookId');

    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId query parameter' }, { status: 400 });
    }

    const book = await prisma.book.findUnique({
      where: {
        id: bookId,
        userId: dbUser.id, // Use database user ID, not Clerk ID
      },
      select: {
        status: true,
        pages: {
          select: {
            id: true,
            text: true,
            generatedImageUrl: true,
            moderationStatus: true,
          },
        },
      },
    });

    if (!book) {
      return NextResponse.json({ error: 'Book not found or access denied' }, { status: 404 });
    }

    // Calculate progress
    const progress = {
      status: book.status,
      totalPages: book.pages.length,
      pagesWithText: book.pages.filter(p => p.text && p.text.trim().length > 0).length,
      pagesWithIllustrations: book.pages.filter(p => p.generatedImageUrl).length,
      failedPages: book.pages.filter(p => p.moderationStatus === 'FAILED').length,
    };

    return NextResponse.json(progress, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error(`Error fetching status for book:`, error);
    return NextResponse.json({ error: 'Failed to fetch book status' }, { status: 500 });
  }
} 