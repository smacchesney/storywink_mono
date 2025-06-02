import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { z } from 'zod';

// Zod schema for request body validation
const updatePageSchema = z.object({
  text: z.string(), // Allow empty string, can be handled by confirmation logic if needed
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookId: string, pageId: string }> }
) {
  const { bookId, pageId } = await params; 
  
  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    if (!bookId || !pageId) {
      return NextResponse.json({ error: 'Missing bookId or pageId parameter' }, { status: 400 });
    }

    // Parse and validate request body
    let requestBody;
    try {
      requestBody = await request.json();
    } catch (error) {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    // Validate the request body structure
    let validatedData;
    try {
      validatedData = updatePageSchema.parse(requestBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'Invalid request data', details: error.errors }, { status: 400 });
      }
      return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
    }

    const { text } = validatedData;

    // Verify user owns the book before proceeding - use database user ID
    const bookOwnerCheck = await prisma.book.findUnique({
      where: { id: bookId, userId: dbUser.id },
      select: { id: true },
    });

    if (!bookOwnerCheck) {
      return NextResponse.json({ error: 'Book not found or you do not have permission.' }, { status: 403 });
    }

    // Update the page text using updateMany to ensure the page belongs to the correct book
    const updateResult = await prisma.page.updateMany({
      where: {
        id: pageId,
        bookId: bookId, // Ensure the page belongs to this book
      },
      data: {
        text: text,
        textConfirmed: true, // Mark as confirmed when manually updated
        updatedAt: new Date(),
      },
    });

    // Check if any record was actually updated
    if (updateResult.count === 0) {
      // Check if the page exists at all to differentiate 404 vs 403
      const pageExists = await prisma.page.findUnique({ where: { id: pageId }, select: { id: true } });
      const status = pageExists ? 403 : 404;
      const message = pageExists ? 'Page does not belong to this book' : 'Page not found';
      return NextResponse.json({ error: message }, { status });
    }

    return NextResponse.json({ message: 'Page updated successfully' }, { status: 200 });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error(`Error updating page ${pageId} in book ${bookId}:`, error);
    return NextResponse.json({ error: 'Failed to update page' }, { status: 500 });
  }
} 