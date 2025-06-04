"use server"; // Mark this file as containing Server Actions

import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from "@/lib/db"; // Use named import
import { Prisma, Book, BookStatus } from "@prisma/client"; // Use @prisma/client directly
import { revalidatePath } from 'next/cache'; // Import for revalidation

// Define the structure of the book data needed by the card
export type LibraryBook = Pick<Book, 'id' | 'title' | 'status' | 'createdAt' | 'childName' | 'updatedAt'> & {
  coverImageUrl: string | null;
};

export interface UserBooksResult {
  inProgressBooks: LibraryBook[];
  completedBooks: LibraryBook[];
  error?: string; // Optional error field
}

export async function getUserBooks(): Promise<UserBooksResult> {
  const logger = (await import('@/lib/logger')).default;
  
  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();
    logger.info({ clerkId, dbUserId: dbUser.id }, "Fetching books for user library.");

    const booksFromDb = await prisma.book.findMany({
      where: { userId: dbUser.id }, // Use database user ID, not Clerk ID
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        childName: true,
        coverAssetId: true, // Ensure coverAssetId is fetched
        pages: {
          orderBy: { index: Prisma.SortOrder.asc }, // Order pages by index
          select: {
            id: true,
            originalImageUrl: true,
            generatedImageUrl: true,
            assetId: true,
            index: true,
            isTitlePage: true,
          },
        },
      },
      orderBy: { updatedAt: Prisma.SortOrder.desc },
    });

    const libraryBooks: LibraryBook[] = booksFromDb.map(book => {
      let determinedCoverImageUrl: string | null = null;
      
      // Find the designated cover page using coverAssetId or fallback to title page/first page
      const coverPageDetails = book.coverAssetId 
        ? book.pages.find(p => p.assetId === book.coverAssetId)
        : book.pages.find(p => p.isTitlePage || p.index === 0);

      if (book.status === BookStatus.COMPLETED) {
        // For COMPLETED books, prioritize the generated image of the cover page
        if (coverPageDetails) {
          determinedCoverImageUrl = coverPageDetails.generatedImageUrl || coverPageDetails.originalImageUrl; // Fallback to original if generated not there
        } else if (book.pages.length > 0) { // Fallback to first page if no specific cover found
          determinedCoverImageUrl = book.pages[0].generatedImageUrl || book.pages[0].originalImageUrl;
        }
      } else {
        // For DRAFT, GENERATING, ILLUSTRATING, FAILED, PARTIAL statuses,
        // use the original image of the cover page
        if (coverPageDetails) {
          determinedCoverImageUrl = coverPageDetails.originalImageUrl;
        } else if (book.pages.length > 0) { // Fallback to first page if no specific cover found
          determinedCoverImageUrl = book.pages[0].originalImageUrl;
        }
      }

      return {
        id: book.id,
        title: book.title ?? 'Untitled Book', // Provide a default for null titles
        status: book.status,
        createdAt: book.createdAt,
        updatedAt: book.updatedAt,
        childName: book.childName,
        coverImageUrl: determinedCoverImageUrl,
      };
    });

    // Books are considered "completed" if they have COMPLETED or PARTIAL status
    // PARTIAL means all illustrations are done but some pages might be missing text (which is OK for title pages)
    const inProgressBooks = libraryBooks.filter(book => book.status !== BookStatus.COMPLETED && book.status !== BookStatus.PARTIAL);
    const completedBooks = libraryBooks.filter(book => book.status === BookStatus.COMPLETED || book.status === BookStatus.PARTIAL);

    logger.info({ clerkId, dbUserId: dbUser.id, inProgressCount: inProgressBooks.length, completedCount: completedBooks.length }, "Successfully fetched user books.");
    return { inProgressBooks, completedBooks };

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return { inProgressBooks: [], completedBooks: [], error: "User not authenticated" };
    }

    const logger = (await import('@/lib/logger')).default;
    logger.error({ error }, "Failed to fetch user books.");
    return { inProgressBooks: [], completedBooks: [], error: error instanceof Error ? error.message : "Failed to fetch books" };
  }
}

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

export async function duplicateBook(bookId: string): Promise<{ success: boolean; message?: string, newBookId?: string }> {
  const logger = (await import('@/lib/logger')).default;
  
  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();
    logger.info({ clerkId, dbUserId: dbUser.id, bookId }, "Attempting to duplicate book.");

    const originalBook = await prisma.book.findUnique({
      where: {
        id: bookId,
        userId: dbUser.id, // Use database user ID, not Clerk ID
      },
      // Select only fields needed for duplication
      select: {
        title: true,
        childName: true,
        pageLength: true,
        artStyle: true,
        tone: true,
        typography: true,
        theme: true,
        keyCharacters: true,
        specialObjects: true,
        excitementElement: true,
        userId: true,
        // Remove fields not needed for duplication
        // createdAt: true,
        // updatedAt: true,
        // coverImageUrl: true, 
        // pages: { ... } 
      }
    });

    if (!originalBook) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId }, "Attempted to duplicate non-existent or unauthorized book.");
      return { success: false, message: "Book not found or access denied." };
    }

    const newBookRecord = await prisma.book.create({
      data: {
        title: `${originalBook.title} (Copy)`,
        childName: originalBook.childName,
        pageLength: originalBook.pageLength,
        artStyle: originalBook.artStyle,
        tone: originalBook.tone,
        typography: originalBook.typography,
        theme: originalBook.theme,
        keyCharacters: originalBook.keyCharacters,
        specialObjects: originalBook.specialObjects,
        excitementElement: originalBook.excitementElement,
        userId: dbUser.id, // Use database user ID, not original book's userId
        status: BookStatus.DRAFT, 
      },
      select: { id: true } // Only need the new ID
    });

    logger.info({ clerkId, dbUserId: dbUser.id, originalBookId: bookId, newBookId: newBookRecord.id }, "Successfully duplicated book.");
    revalidatePath('/library');

    return { success: true, newBookId: newBookRecord.id };

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
    logger.error({ bookId, error }, "Failed to duplicate book.");
    return { success: false, message: "Failed to duplicate book. Please try again." };
  }
} 