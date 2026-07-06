import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { z } from 'zod'; // Import Zod
import { QUEUE_NAMES, STORY_MOODS } from '@storywink/shared/constants';
import {
  collectBookGeneratedPublicIds,
  excludeSharedAssetIds,
  bookGeneratedFolderPrefix,
  ASSET_CLEANUP_PENDING_EVENT,
  type AssetCleanupJobPayload,
} from '@storywink/shared';
import { createBullMQConnection } from '@storywink/shared/redis';
import { Queue } from 'bullmq';
import logger from '@/lib/logger'; // Import logger

// Lazy singleton for the asset-cleanup queue (the shared QueueName enum in
// @/lib/queue predates this queue; workers resolve it via QUEUE_NAMES).
let assetCleanupQueue: Queue | null = null;
function getAssetCleanupQueue(): Queue {
  if (!assetCleanupQueue) {
    assetCleanupQueue = new Queue(QUEUE_NAMES.ASSET_CLEANUP, {
      connection: createBullMQConnection(),
    });
  }
  return assetCleanupQueue;
}

// Zod schema for additional characters in the story
const additionalCharacterSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name too long'),
  relationship: z.string().min(1, 'Relationship is required').max(50, 'Relationship too long'),
});

// Zod schema for the AI-generated capture questions the setup surface edits.
// The parent only ever sets `answer`; the rest round-trips unchanged.
// Length caps bound both DB bloat and the story-prompt surface these
// strings eventually land in.
const captureQuestionSchema = z.object({
  id: z.string().max(100),
  question: z.string().max(300),
  options: z.array(z.string().max(200)).max(8),
  // Links a naming question to its roster character. Nested zod objects strip
  // unknown keys, so without this the id would silently vanish on PATCH and
  // the parent's answer could never merge back into the cast.
  characterId: z.string().max(50).nullable().optional(),
  answer: z.string().max(500).nullable().optional(),
});

// Zod schema for validating PATCH request body
const updateBookSchema = z.object({
  artStyle: z.string().nullable().optional(), // Allow null or undefined
  title: z.string().min(1, { message: 'Title cannot be empty.' }).optional(),
  language: z.enum(['en', 'ja']).optional(),
  coverAssetId: z.string().cuid().nullable().optional(), // For cover changes
  childName: z.string().max(50, 'Name too long').nullable().optional(),
  additionalCharacters: z.array(additionalCharacterSchema).max(5, 'Maximum 5 characters').optional(),
  tone: z.enum(STORY_MOODS).nullable().optional(),
  theme: z.string().max(100).nullable().optional(),
  // The experience-capture fields the setup surface fills before generation.
  eventSummary: z.string().max(500).nullable().optional(),
  captureQuestions: z.array(captureQuestionSchema).max(10).nullable().optional(),
  autoIllustrate: z.boolean().optional(),
}).strict(); // Ensure no extra fields are passed

type RouteContext = { params: Promise<{ bookId: string }> };

export async function GET(
  _req: NextRequest, // Changed from request: Request
  { params }: RouteContext // Applied RouteContext
) {
  const { bookId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    console.log(`Attempting to fetch book ${bookId} for user ${clerkId}`);
    const book = await prisma.book.findUnique({
      where: {
        id: bookId,
        userId: dbUser.id, // Use database user ID for ownership check
      },
      include: {
        pages: {
          orderBy: {
            index: 'asc',
          },
          include: {
            asset: {
              select: {
                id: true,
                url: true,
                thumbnailUrl: true,
              }
            }
          }
        },
      },
    });

    if (!book) {
      console.log(`Book ${bookId} not found or user ${clerkId} does not have permission.`);
      return NextResponse.json({ error: 'Book not found or you do not have permission to view it' }, { status: 404 });
    }

    console.log(`Successfully fetched book ${bookId} with ${book.pages.length} pages including assets.`);

    // Setup prefill: a returning parent's unnamed draft carries the child's
    // name from their most recent book. Derived server-side so the setup
    // page never needs a "list every book" fetch just to read one name.
    // Only unnamed DRAFTs pay the extra query — every named or in-flight
    // book skips it.
    let childNameSuggestion: string | null = null;
    if (!book.childName && book.status === 'DRAFT') {
      const priorBook = await prisma.book.findFirst({
        where: {
          userId: dbUser.id,
          id: { not: bookId },
          childName: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
        select: { childName: true },
      });
      childNameSuggestion = priorBook?.childName ?? null;
    }

    // You might want to conditionally return data based on status if needed
    // For preview, we generally want the data regardless of status to show progress/errors
    return NextResponse.json({ ...book, childNameSuggestion }, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error(`Error fetching book ${bookId}:`, error);
    return NextResponse.json({ error: 'Failed to fetch book data' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest, // Use NextRequest to easily get JSON body
  { params }: RouteContext // Applied RouteContext
) {
  const { bookId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId) {
      logger.warn({ clerkId, dbUserId: dbUser.id }, 'API: Book update attempt missing bookId.');
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    let validatedData;
    try {
      const body = await req.json();
      validatedData = updateBookSchema.parse(body);
      // Check if at least one field is being updated
      if (Object.keys(validatedData).length === 0) {
        return NextResponse.json({ error: 'No update data provided' }, { status: 400 });
      }
      logger.info({ clerkId, dbUserId: dbUser.id, bookId, data: validatedData }, 'API: Validated book update request.');
    } catch (error) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId, error }, 'API: Invalid book update request body.');
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'Invalid request body', details: error.errors }, { status: 400 });
      }
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // If coverAssetId is being changed, log before/after
    if (validatedData.coverAssetId !== undefined) {
      const currentBook = await prisma.book.findUnique({
        where: { id: bookId },
        select: {
          coverAssetId: true,
          pages: {
            where: { isTitlePage: true },
            select: { id: true, assetId: true }
          }
        }
      });

      logger.info({
        clerkId,
        dbUserId: dbUser.id,
        bookId,
        oldCoverAssetId: currentBook?.coverAssetId,
        newCoverAssetId: validatedData.coverAssetId,
        currentTitlePages: currentBook?.pages.map(p => p.id),
        willAffectPages: currentBook?.pages.filter(
          p => p.assetId === validatedData.coverAssetId ||
               p.assetId === currentBook.coverAssetId
        ).length
      }, 'API: Cover asset is being changed');
    }

    // Prepare data for Prisma (serialize additionalCharacters to JSON string)
    const dataForPrisma: Record<string, unknown> = { ...validatedData };
    if (validatedData.additionalCharacters !== undefined) {
      dataForPrisma.additionalCharacters = JSON.stringify(validatedData.additionalCharacters);
    }

    // Use updateMany to ensure user owns the book AND the book exists
    const updateResult = await prisma.book.updateMany({
      where: {
        id: bookId,
        userId: dbUser.id, // Use database user ID for ownership check
      },
      data: {
        ...dataForPrisma,
        updatedAt: new Date(), // Manually update timestamp
      },
    });

    // Check if any record was actually updated
    if (updateResult.count === 0) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId }, 'API: Book update failed - Book not found or user does not own it.');
      // Check if the book exists at all to differentiate 404 vs 403
      const bookExists = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true } });
      const status = bookExists ? 403 : 404;
      const message = bookExists ? 'Permission denied' : 'Book not found';
      return NextResponse.json({ error: message }, { status });
    }

    logger.info({ clerkId, dbUserId: dbUser.id, bookId }, 'API: Book updated successfully.');
    // Optionally fetch and return the updated book data
    // const updatedBook = await prisma.book.findUnique({ where: { id: bookId } });
    // return NextResponse.json(updatedBook, { status: 200 });
    return NextResponse.json({ message: 'Book updated successfully' }, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      logger.warn('API: Book update attempt without authentication.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({ bookId, error }, 'API: Error updating book.');
    // Handle potential Prisma errors, e.g., unique constraint violations if applicable
    return NextResponse.json({ error: 'Failed to update book' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: RouteContext
) {
  const { bookId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId) {
      logger.warn({ clerkId, dbUserId: dbUser.id }, 'API: Book delete attempt missing bookId.');
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    // Photo-deletion pipeline: collect every Cloudinary public id this book
    // owns BEFORE the rows cascade away — original photos (via Asset.publicId,
    // minus any asset another book also references), generated illustrations,
    // the cover render, and character sheets. If collection fails the request
    // 500s WITHOUT deleting, so a retry can never leak photos silently.
    const book = await prisma.book.findUnique({
      where: {
        id: bookId,
        userId: dbUser.id, // Use database user ID for ownership check
      },
      select: {
        coverAssetId: true,
        coverImageUrl: true,
        characterReferences: true,
        pages: { select: { assetId: true, generatedImageUrl: true } },
      },
    });

    if (!book) {
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId }, 'API: Book delete failed - Book not found or user does not own it.');
      const bookExists = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true } });
      const status = bookExists ? 403 : 404;
      const message = bookExists ? 'Permission denied' : 'Book not found';
      return NextResponse.json({ error: message }, { status });
    }

    // A paid print order still moving through fulfillment depends on this
    // book's PrintOrder row (onDelete: Cascade would destroy it): the Lulu
    // poller, the /orders page, and ship/failure notifications all read it.
    // PENDING_PAYMENT stays deletable (abandoned checkouts are never reaped)
    // and SHIPPED releases the guard (nothing advances SHIPPED → DELIVERED).
    const activeOrder = await prisma.printOrder.findFirst({
      where: {
        bookId,
        status: { in: ['PAYMENT_COMPLETED', 'SUBMITTED_TO_LULU', 'IN_PRODUCTION'] },
      },
      select: { id: true, status: true },
    });
    if (activeOrder) {
      logger.info(
        { clerkId, dbUserId: dbUser.id, bookId, printOrderId: activeOrder.id, orderStatus: activeOrder.status },
        'API: Book delete blocked - print order in flight.',
      );
      return NextResponse.json(
        {
          error:
            'A printed copy of this book is still being made. Once your order ships, you can delete the book and we will remove your photos.',
          code: 'PRINT_ORDER_IN_FLIGHT',
        },
        { status: 409 },
      );
    }

    // Shared-asset guard: the create route accepts arbitrary owned assetIds,
    // so another book (page photo or cover) may reference the same upload.
    const candidateAssetIds = excludeSharedAssetIds(
      [...book.pages.map((p) => p.assetId), book.coverAssetId],
      [],
    );
    const [externalPages, externalCovers] = await Promise.all([
      prisma.page.findMany({
        where: { assetId: { in: candidateAssetIds }, bookId: { not: bookId } },
        select: { assetId: true },
      }),
      prisma.book.findMany({
        where: { coverAssetId: { in: candidateAssetIds }, id: { not: bookId } },
        select: { coverAssetId: true },
      }),
    ]);
    const deletableAssetIds = excludeSharedAssetIds(candidateAssetIds, [
      ...externalPages.map((p) => p.assetId),
      ...externalCovers.map((b) => b.coverAssetId),
    ]);
    const deletableAssets = await prisma.asset.findMany({
      where: { id: { in: deletableAssetIds } },
      select: { publicId: true },
    });
    const publicIds = Array.from(
      new Set([
        ...deletableAssets.map((a) => a.publicId),
        ...collectBookGeneratedPublicIds(book),
      ]),
    );
    const prefixes = [bookGeneratedFolderPrefix(bookId)];

    // Durable pre-delete record: if the enqueue below fails (or the process
    // dies in the delete→enqueue gap), the asset-cleanup worker's reconcile
    // pass re-enqueues the deletion from these props. This write THROWS on
    // failure — the request 500s WITHOUT deleting, so photos can never be
    // orphaned silently.
    await prisma.appEvent.create({
      data: {
        name: ASSET_CLEANUP_PENDING_EVENT,
        userId: dbUser.id,
        bookId,
        props: { publicIds, prefixes, reason: 'book_deleted' },
      },
    });

    // Delete only if the authenticated user owns the book.
    // Relies on onDelete: Cascade to remove pages/related records.
    const deleteResult = await prisma.book.deleteMany({
      where: {
        id: bookId,
        userId: dbUser.id, // Use database user ID for ownership check
      },
    });

    if (deleteResult.count === 0) {
      // The book survived — remove the now-stale pending marker (best-effort;
      // the reconcile pass would also drop it after seeing the book exists).
      await prisma.appEvent
        .deleteMany({ where: { name: ASSET_CLEANUP_PENDING_EVENT, bookId } })
        .catch(() => {});
      logger.warn({ clerkId, dbUserId: dbUser.id, bookId }, 'API: Book delete failed - Book not found or user does not own it.');
      const bookExists = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true } });
      const status = bookExists ? 403 : 404;
      const message = bookExists ? 'Permission denied' : 'Book not found';
      return NextResponse.json({ error: message }, { status });
    }

    // Enqueue AFTER the DB delete commits (the worker enforces or dry-runs
    // per ASSET_CLEANUP_ENFORCE). The book folder prefix also catches renders
    // superseded by QC rounds, which no row points at anymore. An enqueue
    // failure must not fail the request — the book is already gone — but it
    // is logged loudly because it means photos remain in Cloudinary.
    try {
      await getAssetCleanupQueue().add(
        `cleanup-book-${bookId}`,
        {
          publicIds,
          prefixes,
          reason: 'book_deleted',
          userId: dbUser.id,
          bookId,
        } satisfies AssetCleanupJobPayload,
        {
          // Deterministic id so the reconcile pass's re-enqueues dedupe.
          jobId: `cleanup-book-${bookId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      );
      logger.info(
        { clerkId, dbUserId: dbUser.id, bookId, publicIdCount: publicIds.length },
        'API: Asset cleanup enqueued for deleted book.',
      );
    } catch (queueError) {
      // Log the FULL target list (manual recovery needs it); the pending
      // AppEvent written above lets the worker's reconcile pass re-enqueue.
      logger.error(
        { clerkId, dbUserId: dbUser.id, bookId, publicIds, prefixes, error: queueError },
        'API: FAILED to enqueue asset cleanup — reconcile pass will retry from the pending record.',
      );
    }

    logger.info({ clerkId, dbUserId: dbUser.id, bookId }, 'API: Book deleted successfully.');
    return NextResponse.json({ success: true, message: 'Book deleted successfully' }, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      logger.warn('API: Book delete attempt without authentication.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({ bookId, error }, 'API: Error deleting book.');
    return NextResponse.json({ error: 'Failed to delete book' }, { status: 500 });
  }
}