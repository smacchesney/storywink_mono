import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';

// POST /api/notifications/mark-all-read - Mark all notifications as read
export async function POST() {
  try {
    const { dbUser } = await getAuthenticatedUser();

    // Mark all unread notifications for this user as read
    const result = await prisma.notification.updateMany({
      where: {
        userId: dbUser.id,
        read: false,
      },
      data: { read: true },
    });

    return NextResponse.json({
      success: true,
      markedCount: result.count
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

    console.error('Error marking all notifications as read:', error);
    return NextResponse.json({ error: 'Failed to mark notifications as read' }, { status: 500 });
  }
}
