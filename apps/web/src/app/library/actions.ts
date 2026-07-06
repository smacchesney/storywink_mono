"use server"; // Mark this file as containing Server Actions

import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from "@/lib/db"; // Use named import
import { revalidatePath } from 'next/cache'; // Import for revalidation

export async function deleteBook(bookId: string): Promise<{ success: boolean; message?: string }> {
  const logger = (await import('@/lib/logger')).default;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();
    logger.info({ clerkId, dbUserId: dbUser.id, bookId }, "Attempting to delete book.");

    const book = await prisma.book.findUnique({
      where: {
        id: bookId,
        userId: dbUser.id, // Use database user ID, not Clerk ID
      },
      select: { id: true },
    });

    if (!book) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId }, "Attempted to delete non-existent or unauthorized book.");
      return { success: false, message: "Book not found or access denied." };
    }

    await prisma.book.delete({
      where: {
        id: bookId,
      },
    });

    logger.info({ clerkId, dbUserId: dbUser.id, bookId }, "Successfully deleted book.");
    revalidatePath('/library');
    return { success: true };

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return { success: false, message: "Authentication required." };
    }

    const logger = (await import('@/lib/logger')).default;
    logger.error({ bookId, error }, "Failed to delete book.");
    return { success: false, message: "Failed to delete book. Please try again." };
  }
}
