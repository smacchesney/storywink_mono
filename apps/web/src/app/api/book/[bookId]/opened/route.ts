import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { trackEvent } from '@storywink/shared';
import logger from '@/lib/logger';

/**
 * POST /api/book/[bookId]/opened
 *
 * Marks the first time the owner opened a readable preview. Idempotent:
 * firstViewedAt is only ever set while null, so every reveal trigger keyed
 * on it fires at most once per book. Always 204 — the caller never branches
 * on this.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;

  try {
    const { dbUser } = await getAuthenticatedUser();

    if (!bookId) {
      return new NextResponse(null, { status: 204 });
    }

    // updateMany carries the ownership check; count 0 means already viewed,
    // not found, or not owned — all fine to ignore for a view marker.
    const result = await prisma.book.updateMany({
      where: { id: bookId, userId: dbUser.id, firstViewedAt: null },
      data: { firstViewedAt: new Date() },
    });

    if (result.count > 0) {
      await trackEvent(prisma, { name: 'first_open', userId: dbUser.id, bookId }, logger);
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('not authenticated') ||
        error.message.includes('ID mismatch') ||
        error.message.includes('primary email not found'))
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({ bookId, error }, 'API: Failed to mark book opened');
    // View marking is best-effort; the reveal must not break on it.
    return new NextResponse(null, { status: 204 });
  }
}
