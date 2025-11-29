import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';

// GET /api/notifications - Get unread notifications for the current user
export async function GET() {
  try {
    const { dbUser } = await getAuthenticatedUser();

    const notifications = await prisma.notification.findMany({
      where: {
        userId: dbUser.id,
        read: false,
      },
      include: {
        book: {
          select: {
            id: true,
            title: true,
            pages: {
              take: 1,
              orderBy: { pageNumber: 'asc' },
              select: {
                generatedImageUrl: true,
                originalImageUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10, // Limit to 10 most recent
    });

    // Transform to include cover image URL
    const notificationsWithCover = notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      read: n.read,
      createdAt: n.createdAt,
      bookId: n.bookId,
      bookTitle: n.book?.title,
      coverImageUrl: n.book?.pages[0]?.generatedImageUrl || n.book?.pages[0]?.originalImageUrl || null,
    }));

    return NextResponse.json({
      notifications: notificationsWithCover,
      unreadCount: notifications.length,
    });
  } catch (error) {
    // Handle authentication errors
    if (
      error instanceof Error &&
      (error.message.includes('not authenticated') ||
        error.message.includes('ID mismatch') ||
        error.message.includes('primary email not found'))
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error('Error fetching notifications:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}
