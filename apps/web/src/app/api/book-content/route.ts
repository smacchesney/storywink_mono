import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { dbUser } = await getAuthenticatedUser();
    
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('bookId');

    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    const book = await prisma.book.findUnique({
      where: {
        id: bookId,
        userId: dbUser.id, // Use database user ID, not Clerk ID
      },
      include: {
        pages: { // Include the related pages
          orderBy: {
            index: 'asc', // Order pages by user-defined sequence
          },
          select: {
            id: true,
            text: true, // Select the text field
            pageNumber: true,
            // Add other fields if needed by review page, e.g., originalImageUrl?
          },
        },
      },
    });

    if (!book) {
      return NextResponse.json({ error: 'Book not found or access denied' }, { status: 404 });
    }

    // We only need to return the pages array for the frontend
    return NextResponse.json({ pages: book.pages }, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error(`Error fetching content for book:`, error);
    return NextResponse.json({ error: 'Failed to fetch book content' }, { status: 500 });
  }
} 