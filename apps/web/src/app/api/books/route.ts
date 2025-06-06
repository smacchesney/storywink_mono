import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';

export async function GET() {
  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();
    
    logger.info({ clerkId, dbUserId: dbUser.id }, 'API: Fetching books for user.');
    
    // Fetch books for the authenticated user
    const books = await prisma.book.findMany({
      where: {
        userId: dbUser.id,
      },
      include: {
        pages: {
          select: {
            id: true,
            originalImageUrl: true,
            generatedImageUrl: true,
          },
          orderBy: { pageNumber: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    
    logger.info({ clerkId, dbUserId: dbUser.id, bookCount: books.length }, 'API: Successfully fetched books.');
    
    return NextResponse.json({ 
      success: true, 
      data: books 
    }, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      logger.warn('API: Books fetch attempt without authentication.');
      return NextResponse.json({ 
        success: false, 
        error: 'Unauthorized' 
      }, { status: 401 });
    }

    logger.error({ error }, 'API: Error fetching books.');
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch books' 
    }, { status: 500 });
  }
}