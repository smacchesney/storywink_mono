import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { z } from 'zod';
import { v2 as cloudinary } from 'cloudinary';
import logger from '@/lib/logger';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Zod schema for character creation
const characterSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  sourceAssetId: z.string().cuid(),
  faceBounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  croppedFaceDataUrl: z.string().startsWith('data:image/'),
});

const createCharactersSchema = z.object({
  characters: z.array(characterSchema).min(1).max(10),
});

type RouteContext = { params: Promise<{ bookId: string }> };

// POST: Save selected characters
export async function POST(
  req: NextRequest,
  { params }: RouteContext
) {
  const { bookId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    // Parse and validate request body
    let validatedData;
    try {
      const body = await req.json();
      validatedData = createCharactersSchema.parse(body);
    } catch (error) {
      logger.warn({ clerkId, bookId, error }, 'Invalid character creation request body');
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'Invalid request body', details: error.errors }, { status: 400 });
      }
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Verify book ownership
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId: dbUser.id },
      select: { id: true },
    });

    if (!book) {
      logger.warn({ clerkId, bookId }, 'Book not found or user does not own it');
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Delete existing characters (replace mode)
    const deletedCount = await prisma.character.deleteMany({ where: { bookId } });
    logger.info({ bookId, deletedCount: deletedCount.count }, 'Deleted existing characters');

    // Create new characters with Cloudinary uploads
    const characters = await Promise.all(
      validatedData.characters.map(async (char, index) => {
        // Upload cropped face to Cloudinary
        let croppedFaceUrl: string;
        try {
          const uploadResult = await cloudinary.uploader.upload(char.croppedFaceDataUrl, {
            folder: `user_${dbUser.id}/characters`,
            resource_type: 'image',
            transformation: [
              { width: 400, height: 400, crop: 'fill', gravity: 'face' },
              { quality: 'auto', fetch_format: 'auto' },
            ],
          });
          croppedFaceUrl = uploadResult.secure_url;
        } catch (uploadError) {
          logger.error({ error: uploadError, bookId, characterName: char.name }, 'Failed to upload character face to Cloudinary');
          throw new Error(`Failed to upload face image for ${char.name}`);
        }

        return prisma.character.create({
          data: {
            bookId,
            name: char.name,
            croppedFaceUrl,
            sourceAssetId: char.sourceAssetId,
            faceBounds: char.faceBounds,
            displayOrder: index,
            isMainCharacter: true,
          },
        });
      })
    );

    logger.info({ bookId, characterCount: characters.length }, 'Characters saved successfully');
    return NextResponse.json({ characters }, { status: 201 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({ bookId, error }, 'Error saving characters');
    return NextResponse.json({ error: 'Failed to save characters' }, { status: 500 });
  }
}

// GET: Retrieve characters for a book
export async function GET(
  _req: NextRequest,
  { params }: RouteContext
) {
  const { bookId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    // Verify book ownership
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId: dbUser.id },
      select: { id: true },
    });

    if (!book) {
      logger.warn({ clerkId, bookId }, 'Book not found or user does not own it');
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const characters = await prisma.character.findMany({
      where: { bookId },
      orderBy: { displayOrder: 'asc' },
      select: {
        id: true,
        name: true,
        croppedFaceUrl: true,
        sourceAssetId: true,
        faceBounds: true,
        isMainCharacter: true,
        displayOrder: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ characters }, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({ bookId, error }, 'Error fetching characters');
    return NextResponse.json({ error: 'Failed to fetch characters' }, { status: 500 });
  }
}

// DELETE: Remove all characters from a book
export async function DELETE(
  _req: NextRequest,
  { params }: RouteContext
) {
  const { bookId } = await params;

  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    // Verify book ownership
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId: dbUser.id },
      select: { id: true },
    });

    if (!book) {
      logger.warn({ clerkId, bookId }, 'Book not found or user does not own it');
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const deletedCount = await prisma.character.deleteMany({ where: { bookId } });
    logger.info({ bookId, deletedCount: deletedCount.count }, 'Characters deleted');

    return NextResponse.json({ message: 'Characters deleted', count: deletedCount.count }, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({ bookId, error }, 'Error deleting characters');
    return NextResponse.json({ error: 'Failed to delete characters' }, { status: 500 });
  }
}
