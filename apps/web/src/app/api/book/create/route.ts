import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { z } from 'zod';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { checkRateLimit } from '@/lib/rateLimit';
import { BookStatus, PageType } from '@prisma/client';
import { QueueName, getQueue } from '@/lib/queue/index';
import { avatarsEnabled } from '@/lib/avatars';
import { isValidStyle } from '@storywink/shared/prompts/styles';
import {
  castComposition,
  buildAvatarStoryRoster,
  CastKind,
  StoredAvatarIdentity,
} from '@/lib/avatar-story';
// X6d: avatar-first stories — no photos, a cast of account avatars, a
// parent-picked spark, and a page count. Dark behind AVATARS_ENABLED.
import { createAvatarBookSchema } from '@/lib/avatar-story-schema';
import { coverComposedEnabled } from '@/lib/outing-v2';

// Zod schema for request body validation
const createBookSchema = z.object({
  assetIds: z
    .array(z.string().cuid())
    .min(1, { message: 'At least one asset ID is required.' })
    .max(23, { message: 'Maximum 23 photos per book.' }),
  language: z.enum(['en', 'ja']).default('en'),
});

/**
 * AVATAR_STORY branch: creates the book, its photo-less bridge-source pages,
 * and the BookAvatar cast links (characterIds minted in pick order) in one
 * transaction. No photo-analysis enqueue — there are no photos to perceive.
 */
async function createAvatarStoryBook(
  dbUserId: string,
  input: z.infer<typeof createAvatarBookSchema>,
): Promise<NextResponse> {
  const { avatarIds, premise, pageLength, artStyle, language } = input;

  if (!isValidStyle(artStyle)) {
    return NextResponse.json({ error: 'Unknown art style.' }, { status: 400 });
  }

  // Dedupe defensively — double-tapping a card must not mint two roster ids.
  const uniqueAvatarIds = Array.from(new Set(avatarIds));

  const avatars = await prisma.avatar.findMany({
    where: { id: { in: uniqueAvatarIds }, userId: dbUserId },
    include: {
      renditions: { where: { status: 'READY', artStyle } },
    },
  });
  const avatarById = new Map(avatars.map((a) => [a.id, a]));

  if (avatars.length !== uniqueAvatarIds.length) {
    return NextResponse.json({ error: 'Character not found.' }, { status: 404 });
  }
  const notReady = avatars.filter(
    (a) => a.status !== 'READY' || !a.renditions[0]?.turnaroundSheetUrl,
  );
  if (notReady.length > 0) {
    // The cast picker prevents this; reaching here means a stale client.
    return NextResponse.json(
      { error: 'Every character needs a finished drawing in this style first.' },
      { status: 409 },
    );
  }

  // Preserve pick order — the roster ids and the star follow it. The cast rule
  // mirrors the client (castComposition): one character is enough, six is the
  // ceiling, any mix of people/pets/toys between is the parent's call. The
  // request schema already bounds avatarIds to 1..6; this is the same floor and
  // ceiling enforced against the resolved cast (defense in depth).
  const cast = uniqueAvatarIds.map((id) => avatarById.get(id)!);
  const composition = castComposition(cast.map((a) => a.kind as CastKind));
  if (!composition.ok) {
    return NextResponse.json({ error: 'A story holds one to six characters.' }, { status: 400 });
  }

  const { characters, childName } = buildAvatarStoryRoster(
    cast.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      kind: a.kind as CastKind,
      identity: a.identity as StoredAvatarIdentity | null,
    })),
  );

  const newBook = await prisma.$transaction(async (tx) => {
    const book = await tx.book.create({
      data: {
        userId: dbUserId,
        title: '', // model-suggested at story time, same as the photo path
        status: BookStatus.DRAFT,
        bookType: 'AVATAR_STORY',
        pageLength,
        language,
        artStyle,
        childName,
        eventSummary: premise, // the spark rides the premise seam
        coverAssetId: null, // no photo cover exists — Book.coverImageUrl is generated
        autoIllustrate: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        characterIdentity: { characters, sceneContext: '' } as any, // Prisma Json column
      },
    });

    await tx.page.createMany({
      data: Array.from({ length: pageLength }, (_, i) => ({
        bookId: book.id,
        pageNumber: i + 1,
        index: i,
        assetId: null,
        originalImageUrl: null,
        pageType: PageType.SINGLE,
        isTitlePage: i === 0,
        // Bridge-source rows: photo-less, scene-driven, sheet-anchored — the
        // story worker fills text + bridgeScene, the illustration worker
        // renders them via the bridge branch.
        source: 'BRIDGE' as const,
      })),
    });

    await tx.bookAvatar.createMany({
      data: cast.map((avatar, i) => ({
        bookId: book.id,
        avatarId: avatar.id,
        characterId: `avatar_${i + 1}`,
      })),
    });

    return book;
  });

  logger.info(
    { dbUserId, bookId: newBook.id, castSize: cast.length, pageLength, artStyle },
    'API: Avatar-story book created.',
  );

  return NextResponse.json(
    { success: true, data: { id: newBook.id, bookId: newBook.id } },
    { status: 201 },
  );
}

export async function POST(req: NextRequest) {
  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    const rl = await checkRateLimit(`book-create:${dbUser.id}`, 20, 3600);
    if (!rl.allowed) {
      logger.warn(
        { dbUserId: dbUser.id, key: `book-create:${dbUser.id}`, remaining: rl.remaining },
        'Rate limit exceeded: book create',
      );
      if (process.env.RATE_LIMIT_ENFORCE === 'true') {
        return NextResponse.json(
          {
            error: "You're creating books very quickly. Please wait a little while and try again.",
          },
          { status: 429 },
        );
      }
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      // Same response malformed JSON always got (pre-X6d parity: the parse
      // error never reached the zod branch, so no `details` field).
      logger.warn({ clerkId, dbUserId: dbUser.id }, 'API: Book creation body was not valid JSON.');
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // X6d: the avatar-first branch is discriminated by bookType and dark
    // behind AVATARS_ENABLED (404s like every other avatar surface).
    if (
      body &&
      typeof body === 'object' &&
      (body as { bookType?: string }).bookType === 'AVATAR_STORY'
    ) {
      if (!avatarsEnabled()) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const parsed = createAvatarBookSchema.safeParse(body);
      if (!parsed.success) {
        logger.warn(
          { clerkId, dbUserId: dbUser.id, issues: parsed.error.issues },
          'API: Invalid avatar-book creation request body.',
        );
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
      }
      return await createAvatarStoryBook(dbUser.id, parsed.data);
    }

    let validatedData;
    try {
      console.log('>>> DEBUG: Book creation request body:', body);
      validatedData = createBookSchema.parse(body);
      logger.info(
        {
          clerkId,
          dbUserId: dbUser.id,
          assetCount: validatedData.assetIds.length,
          assetIds: validatedData.assetIds,
        },
        'API: Validated book creation request.',
      );
    } catch (error) {
      logger.warn(
        { clerkId, dbUserId: dbUser.id, error },
        'API: Invalid book creation request body.',
      );
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request body', details: error.errors },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { assetIds, language } = validatedData;

    // Use a transaction to ensure atomicity
    const newBook = await prisma.$transaction(async (tx) => {
      logger.info({ clerkId, dbUserId: dbUser.id }, 'API: Starting book creation transaction.');

      // Fetch Assets to get URLs - use database user ID, not Clerk ID
      console.log(
        `>>> DEBUG: Querying assets - userId: ${dbUser.id}, assetIds: ${assetIds.join(', ')}`,
      );
      const assets = await tx.asset.findMany({
        where: {
          id: { in: assetIds },
          userId: dbUser.id, // Use database user ID instead of Clerk ID
        },
        select: {
          id: true,
          url: true,
          thumbnailUrl: true,
        },
      });
      console.log(
        `>>> DEBUG: Found ${assets.length} of ${assetIds.length} assets for userId ${dbUser.id}`,
      );

      // Create a map for easy lookup
      const assetMap = new Map(assets.map((a) => [a.id, a]));

      // Check if all requested assetIds were found and belong to the user
      if (assets.length !== assetIds.length) {
        const foundIds = new Set(assets.map((a) => a.id));
        const missingIds = assetIds.filter((id) => !foundIds.has(id));
        logger.error(
          {
            clerkId,
            dbUserId: dbUser.id,
            bookId: '(pending)',
            missingIds,
            requestedIds: assetIds,
            foundAssets: assets,
          },
          'API: Some assets not found or permission denied during book creation.',
        );
        console.error(
          `>>> DEBUG: Asset validation failed. Requested: ${assetIds.join(', ')}, Found: ${assets.map((a) => a.id).join(', ')}`,
        );
        throw new Error(`Assets not found or permission denied for IDs: ${missingIds.join(', ')}`);
      }
      logger.info(
        { clerkId, dbUserId: dbUser.id, assetCount: assets.length },
        'API: Fetched asset URLs within transaction.',
      );

      // X17 A1 (COVER_COMPOSED_ENABLED): no photo is spent on the cover — the
      // composed cover renders at finalize, keyed off coverAssetId == null
      // (book state, not this flag). Flag off: legacy first-photo cover,
      // byte-identical end to end.
      const composedCover = coverComposedEnabled();

      // 1. Create the Book record - use database user ID
      const book = await tx.book.create({
        data: {
          userId: dbUser.id, // Use database user ID instead of Clerk ID
          title: '', // Start with empty title as per new requirements
          status: BookStatus.DRAFT,
          pageLength: assetIds.length, // Set page length based on provided assets
          language,
          coverAssetId: composedCover ? null : assetIds[0], // legacy: first photo becomes the cover
          autoIllustrate: true, // Product default: chain straight into illustration after story success
          // Other fields like artStyle will be set later in the editor
        },
      });
      logger.info(
        { clerkId, dbUserId: dbUser.id, bookId: book.id },
        'API: Book record created within transaction.',
      );

      // 2. Prepare Page records data - NOW WITH IMAGE URL
      const pagesData = assetIds.map((assetId, index) => {
        const asset = assetMap.get(assetId);
        if (!asset) {
          // This shouldn't happen due to the check above, but belts and braces
          throw new Error(`Internal error: Asset data missing for ID ${assetId}`);
        }
        return {
          bookId: book.id,
          pageNumber: index + 1,
          index: index,
          assetId: assetId,
          originalImageUrl: asset.thumbnailUrl || asset.url, // <-- Use fetched URL (prefer thumbnail)
          pageType: PageType.SINGLE,
          isTitlePage: composedCover ? false : index === 0,
        };
      });

      // 3. Create Page records
      await tx.page.createMany({ data: pagesData });
      logger.info(
        { clerkId, dbUserId: dbUser.id, bookId: book.id, pageCount: pagesData.length },
        'API: Page records created within transaction.',
      );

      logger.info(
        { clerkId, dbUserId: dbUser.id, bookId: book.id },
        'API: Book creation transaction committed.',
      );
      return book; // Return the created book
    });

    console.log(`>>> DEBUG: Book creation successful! Book ID: ${newBook.id}`);

    // Kick off the photo perception pass immediately so the story brief,
    // capture questions, and character identity are ready by the time the
    // parent reaches the setup sheet. Failure here never blocks creation.
    try {
      await getQueue(QueueName.PhotoAnalysis).add(
        `analyze-photos-${newBook.id}`,
        { bookId: newBook.id, userId: dbUser.id },
        {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      );
    } catch (queueError) {
      logger.error(
        { bookId: newBook.id, error: queueError },
        'API: Failed to enqueue photo analysis (non-fatal).',
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: { id: newBook.id, bookId: newBook.id },
      },
      { status: 201 },
    ); // 201 Created
  } catch (error) {
    // Handle authentication errors
    if (
      error instanceof Error &&
      (error.message.includes('not authenticated') ||
        error.message.includes('ID mismatch') ||
        error.message.includes('primary email not found'))
    ) {
      logger.warn('API: Book creation attempt without authentication.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Log error details explicitly for Railway visibility
    console.error('>>> ERROR: Book creation failed!');
    console.error('>>> Error type:', error?.constructor?.name);
    console.error('>>> Error message:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('>>> Stack trace:', error.stack.split('\n').slice(0, 5).join('\n'));
    }
    // Also check for Prisma-specific error properties
    if (error && typeof error === 'object') {
      const prismaError = error as { code?: string; meta?: unknown };
      if (prismaError.code) console.error('>>> Prisma error code:', prismaError.code);
      if (prismaError.meta)
        console.error('>>> Prisma error meta:', JSON.stringify(prismaError.meta));
    }
    logger.error(
      {
        err: error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      },
      'API: Error during book creation transaction.',
    );
    // Specific error handling (e.g., foreign key constraint if assetId doesn't exist)
    if (error instanceof Error && error.message.includes('Foreign key constraint failed')) {
      return NextResponse.json(
        { error: 'One or more provided asset IDs do not exist or belong to another user.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Failed to create book draft' }, { status: 500 });
  }
}
