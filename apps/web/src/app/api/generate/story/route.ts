import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { z } from 'zod';
import { getQueue, QueueName } from '@/lib/queue'; // Correct queue import
// Import types from the default client path
import { BookStatus } from '@prisma/client';
// Import shared prisma instance
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { checkRateLimit } from '@/lib/rateLimit';
import type { StoryGenerationInput } from '@storywink/shared';

// REMOVED local BookStatus enum workaround (Task 7.8)

// REMOVED type Asset = any; workaround (Task 7.8)

// Define the expected input schema using Zod
// const storyRequestSchema = z.object({
//   childName: z.string().min(1, { message: "Child's name is required" }),
//   bookTitle: z.string().min(1, { message: "Book title is required" }),
//   pageCount: z.union([
//    z.literal(8),
//    z.literal(12),
//    z.literal(16),
//  ]),
//  isDoubleSpread: z.boolean(),
//  droppedAssets: z.record(
//    z.string(), // Allow any string key (numeric index OR 'title-page')
//    z.string().nullable() // Value: assetId or null
//  ),
//  // Optional fields - ensure they are strings or undefined
//  storyTone: z.string().optional(),
//  artStyle: z.string().optional(),
//  theme: z.string().optional().default(''), // Use default to avoid undefined
//  people: z.string().optional().default(''),
//  objects: z.string().optional().default(''),
//  excitementElement: z.string().optional().default(''),
//  isWinkifyEnabled: z.boolean().optional().default(false), // Add field to schema
// });

// Define the data structure required by the story generation worker job
export interface StoryGenerationJobData {
  userId: string;
  bookId: string;
  // Context needed for prompt generation
  promptContext: Omit<
    StoryGenerationInput,
    'assets' | 'droppedAssets' | 'pageCount' | 'storyPages'
  >;
  // Array of story pages needing text generation
  storyPages: {
    pageId: string;
    pageNumber: number;
    assetId: string | null;
    originalImageUrl: string | null;
  }[];
  // True when the title was a server-filled placeholder — the worker adopts
  // the model's suggestedTitle in that case.
  titleWasGenerated?: boolean;
}

// Zod schema for the NEW request body
const triggerStoryRequestSchema = z.object({
  bookId: z.string().cuid(),
  // Opt-in review gate: when true the book stops at STORY_READY for manual
  // review instead of auto-chaining into illustration.
  reviewFirst: z.boolean().optional(),
});

function placeholderTitle(childName: string | null, language: string): string {
  if (language === 'ja') {
    return childName ? `${childName}のだいぼうけん` : 'ぼくらのだいぼうけん';
  }
  return childName ? `${childName}'s Big Adventure` : 'Our Big Adventure';
}

export async function POST(req: NextRequest) {
  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    const rl = await checkRateLimit(`generate-story:${dbUser.id}`, 10, 3600);
    if (!rl.allowed) {
      logger.warn(
        { dbUserId: dbUser.id, key: `generate-story:${dbUser.id}`, remaining: rl.remaining },
        'Rate limit exceeded: generate story',
      );
      if (process.env.RATE_LIMIT_ENFORCE === 'true') {
        return NextResponse.json(
          {
            error:
              "You're generating stories very quickly. Please wait a little while and try again.",
          },
          { status: 429 },
        );
      }
    }

    let validatedData;
    try {
      const body = await req.json();
      validatedData = triggerStoryRequestSchema.parse(body);
      logger.info(
        { clerkId, dbUserId: dbUser.id, bookId: validatedData.bookId },
        'API: Validated /generate/story request.',
      );
    } catch (error) {
      logger.warn(
        { clerkId, dbUserId: dbUser.id, error },
        'API: Invalid /generate/story request body.',
      );
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request body', details: error.errors },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { bookId, reviewFirst } = validatedData;

    // 1. Fetch Book, Pages, and Assets (ensure user owns the book)
    const book = await prisma.book.findUnique({
      where: { id: bookId, userId: dbUser.id },
      include: {
        pages: {
          orderBy: { index: 'asc' }, // Fetch sorted by saved index
          include: {
            asset: { select: { id: true, url: true, thumbnailUrl: true } },
          },
        },
      },
    });

    if (!book) {
      logger.warn(
        { clerkId, dbUserId: dbUser.id, bookId },
        'API: /generate/story - Book not found or permission denied.',
      );
      return NextResponse.json({ error: 'Book not found or permission denied' }, { status: 404 });
    }

    // 2. Fill generation defaults instead of gating. A missing art style falls
    // back to the product default; a missing title gets a placeholder and the
    // story model's suggestedTitle replaces it on completion.
    const artStyle = book.artStyle || 'vignette';
    const titleWasGenerated = !book.title?.trim();
    const title = book.title?.trim() || placeholderTitle(book.childName, book.language || 'en');

    // Ensure book is in a state where generation can be started (e.g., DRAFT or maybe FAILED)
    if (
      book.status !== BookStatus.DRAFT &&
      book.status !== BookStatus.FAILED &&
      book.status !== BookStatus.COMPLETED
    ) {
      // Allow re-gen from COMPLETED? Maybe not.
      logger.warn(
        { clerkId, dbUserId: dbUser.id, bookId, status: book.status },
        'API: /generate/story - Book not in DRAFT or FAILED state.',
      );
      return NextResponse.json(
        { error: `Book generation cannot be started from current status: ${book.status}` },
        { status: 409 },
      ); // Conflict
    }

    // 3. Prepare all pages for story generation (including cover page)
    const pagesForStory = book.pages.map((page) => ({
      pageId: page.id,
      pageNumber: page.pageNumber,
      assetId: page.assetId,
      originalImageUrl: page.asset?.thumbnailUrl || page.asset?.url || page.originalImageUrl,
    }));

    if (pagesForStory.length === 0) {
      logger.error(
        { clerkId, dbUserId: dbUser.id, bookId },
        'API: /generate/story - No pages available for story generation.',
      );
      return NextResponse.json({ error: 'No pages found to generate story for.' }, { status: 400 });
    }

    logger.info(
      { clerkId, dbUserId: dbUser.id, bookId, pageCount: pagesForStory.length },
      'API: /generate/story - Prepared pages for job queue.',
    );

    // 4. Update Book status to GENERATING (persisting any filled defaults so
    // the worker and prompts read consistent values from the DB)
    await prisma.book.update({
      where: { id: bookId },
      data: {
        status: BookStatus.GENERATING,
        ...(titleWasGenerated ? { title } : {}),
        ...(!book.artStyle ? { artStyle } : {}),
        ...(reviewFirst !== undefined ? { autoIllustrate: !reviewFirst } : {}),
      },
    });
    logger.info(
      { clerkId, dbUserId: dbUser.id, bookId, titleWasGenerated, artStyle },
      'API: /generate/story - Set book status to GENERATING.',
    );

    // 5. Prepare Job Data
    const jobData: StoryGenerationJobData = {
      userId: dbUser.id, // Use database user ID
      bookId,
      promptContext: {
        // Simplified prompt context
        bookTitle: title,
        artStyle,
        isDoubleSpread: false,
        language: book.language || 'en',
      },
      storyPages: pagesForStory,
      titleWasGenerated,
    };

    // 6. Add job to queue using getQueue
    const storyQueue = getQueue(QueueName.StoryGeneration);
    await storyQueue.add(`generate-story-${bookId}`, jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
    });
    logger.info(
      { clerkId, dbUserId: dbUser.id, bookId },
      'API: /generate/story - Job added to StoryGeneration queue.',
    );

    // 7. Return Accepted response
    return NextResponse.json(
      { message: 'Story generation initiated', bookId: bookId },
      { status: 202 },
    );
  } catch (error) {
    // Handle authentication errors first
    if (
      error instanceof Error &&
      (error.message.includes('not authenticated') ||
        error.message.includes('ID mismatch') ||
        error.message.includes('primary email not found'))
    ) {
      logger.warn('API: /generate/story attempt without authentication.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // For other errors, try to extract context if available
    const errorData = error as any;
    const bookId = errorData?.bookId || 'unknown';

    logger.error({ bookId, error }, 'API: Error in /generate/story endpoint.');
    // Attempt to reset status to FAILED if something went wrong after setting GENERATING
    try {
      await prisma.book.updateMany({
        where: { id: bookId, status: BookStatus.GENERATING },
        data: { status: BookStatus.FAILED },
      });
    } catch (resetError) {
      logger.error(
        { bookId, resetError },
        'API: Failed to reset book status to FAILED after error.',
      );
    }
    return NextResponse.json({ error: 'Failed to initiate story generation' }, { status: 500 });
  }
}
