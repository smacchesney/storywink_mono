import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { bookId: string } }
) {
  try {
    const { dbUser } = await getAuthenticatedUser();
    const { bookId } = params;

    // Verify book ownership
    const book = await prisma.book.findUnique({
      where: {
        id: bookId,
        userId: dbUser.id,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!book) {
      return new Response('Book not found', { status: 404 });
    }

    // Create SSE response
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Send initial status
    writer.write(
      encoder.encode(`data: ${JSON.stringify({ status: book.status, timestamp: new Date() })}\n\n`)
    );

    // Poll for updates (in production, use Redis pub/sub or similar)
    const interval = setInterval(async () => {
      try {
        const updatedBook = await prisma.book.findUnique({
          where: { id: bookId },
          select: {
            status: true,
            pages: {
              select: {
                id: true,
                generatedImageUrl: true,
                moderationStatus: true,
              },
            },
          },
        });

        if (updatedBook) {
          const progress = {
            status: updatedBook.status,
            totalPages: updatedBook.pages.length,
            completedPages: updatedBook.pages.filter(p => p.generatedImageUrl).length,
            failedPages: updatedBook.pages.filter(p => p.moderationStatus === 'FAILED').length,
            timestamp: new Date(),
          };

          writer.write(
            encoder.encode(`data: ${JSON.stringify(progress)}\n\n`)
          );

          // Close stream if final status reached
          if (['COMPLETED', 'FAILED', 'PARTIAL'].includes(updatedBook.status)) {
            clearInterval(interval);
            writer.close();
          }
        }
      } catch (error) {
        console.error('SSE polling error:', error);
        clearInterval(interval);
        writer.close();
      }
    }, 2000); // Poll every 2 seconds

    // Clean up on client disconnect
    request.signal.addEventListener('abort', () => {
      clearInterval(interval);
      writer.close();
    });

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes('not authenticated') ||
      error.message.includes('ID mismatch') ||
      error.message.includes('primary email not found')
    )) {
      return new Response('Unauthorized', { status: 401 });
    }

    console.error('SSE error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}