import { BookStatus } from '@prisma/client';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';

export interface BookProgress {
  status: BookStatus;
  totalPages: number;
  pagesWithText: number;
  pagesWithIllustrations: number;
  failedPages: number;
  percentComplete: number;
}

export interface StatusUpdate {
  status: BookStatus;
  metadata?: {
    failedPageIds?: string[];
    errorMessage?: string;
    completedAt?: Date;
  };
}

export class BookStatusService {
  /**
   * Update book status with logging and event emission
   */
  static async updateStatus(bookId: string, update: StatusUpdate): Promise<void> {
    try {
      logger.info({ bookId, update }, 'Updating book status');

      await prisma.book.update({
        where: { id: bookId },
        data: {
          status: update.status,
          updatedAt: new Date(),
        },
      });

      // TODO: In production, emit Redis pub/sub event here for real-time updates
      // await redis.publish(`book:${bookId}:status`, JSON.stringify(update));

      logger.info({ bookId, newStatus: update.status }, 'Book status updated successfully');
    } catch (error) {
      logger.error({ bookId, error, update }, 'Failed to update book status');
      throw error;
    }
  }

  /**
   * Get detailed book progress
   */
  static async getDetailedStatus(bookId: string): Promise<BookProgress | null> {
    try {
      const book = await prisma.book.findUnique({
        where: { id: bookId },
        include: {
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

      if (!book) return null;

      const totalPages = book.pages.length;
      const pagesWithText = book.pages.filter(p => p.text && p.text.trim().length > 0).length;
      const pagesWithIllustrations = book.pages.filter(p => p.generatedImageUrl).length;
      const failedPages = book.pages.filter(p => p.moderationStatus === 'FAILED').length;

      // Calculate percentage based on current status
      let percentComplete = 0;
      if (book.status === 'DRAFT') {
        percentComplete = 0;
      } else if (book.status === 'GENERATING') {
        percentComplete = Math.round((pagesWithText / totalPages) * 30); // Story is 30% of total
      } else if (book.status === 'STORY_READY') {
        percentComplete = 30;
      } else if (book.status === 'ILLUSTRATING') {
        percentComplete = 30 + Math.round((pagesWithIllustrations / totalPages) * 70); // Illustrations are 70%
      } else if (book.status === 'COMPLETED') {
        percentComplete = 100;
      } else if (book.status === 'PARTIAL') {
        percentComplete = 30 + Math.round((pagesWithIllustrations / totalPages) * 70);
      }

      return {
        status: book.status,
        totalPages,
        pagesWithText,
        pagesWithIllustrations,
        failedPages,
        percentComplete,
      };
    } catch (error) {
      logger.error({ bookId, error }, 'Failed to get detailed book status');
      throw error;
    }
  }

  /**
   * Check if book is in a final state
   */
  static isFinalStatus(status: BookStatus): boolean {
    return ['COMPLETED', 'FAILED', 'PARTIAL'].includes(status);
  }

  /**
   * Check if book can transition to a new status
   */
  static canTransitionTo(currentStatus: BookStatus, newStatus: BookStatus): boolean {
    const transitions: Record<BookStatus, BookStatus[]> = {
      DRAFT: ['GENERATING', 'FAILED'],
      GENERATING: ['STORY_READY', 'FAILED'],
      STORY_READY: ['ILLUSTRATING', 'FAILED'],
      ILLUSTRATING: ['COMPLETED', 'PARTIAL', 'FAILED'],
      COMPLETED: [], // Final state
      PARTIAL: ['ILLUSTRATING'], // Can retry illustrations
      FAILED: ['DRAFT'], // Can reset to draft
    };

    return transitions[currentStatus]?.includes(newStatus) ?? false;
  }
}