import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { checkRateLimit } from '@/lib/rateLimit';
import { clientEventSchema, MAX_PROPS_BYTES } from '@/lib/client-events';
import logger from '@/lib/logger';

/**
 * POST /api/events
 *
 * Funnel telemetry sink. The event is attributed to the authenticated user
 * (client-sent userId is never trusted). bookId is opaque telemetry context,
 * deliberately not ownership-checked. `name` is a closed enum of client
 * funnel events (see client-events.ts) — AppEvent is also the workers'
 * control-plane store, so worker-owned names must be unforgeable from here.
 */
export async function POST(req: NextRequest) {
  try {
    const { dbUser } = await getAuthenticatedUser();

    // Same pattern as the other write routes (book-create, generate/story,
    // reillustrate): log-only until RATE_LIMIT_ENFORCE=true, so default
    // behavior is unchanged when the flag is unset. 300/hr is ~5/min
    // sustained — far above what the app's handful of track() call sites can
    // produce in a legitimate session, but it caps floods and bulk forging.
    const rl = await checkRateLimit(`events:${dbUser.id}`, 300, 3600);
    if (!rl.allowed) {
      logger.warn(
        { dbUserId: dbUser.id, key: `events:${dbUser.id}`, remaining: rl.remaining },
        'Rate limit exceeded: events',
      );
      if (process.env.RATE_LIMIT_ENFORCE === 'true') {
        // track() is fire-and-forget and never reads the response; drop
        // silently (204 keeps devtools quiet where a 429 would flag red).
        return new NextResponse(null, { status: 204 });
      }
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const parsed = clientEventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { name, bookId, props } = parsed.data;
    if (props !== undefined && Buffer.byteLength(JSON.stringify(props), 'utf8') > MAX_PROPS_BYTES) {
      return NextResponse.json({ error: 'props too large' }, { status: 400 });
    }

    await prisma.appEvent.create({
      data: {
        name,
        userId: dbUser.id,
        bookId: bookId ?? null,
        ...(props !== undefined ? { props: props as Prisma.InputJsonValue } : {}),
      },
    });

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

    logger.error({ error }, 'API: Failed to record event');
    return NextResponse.json({ error: 'Failed to record event' }, { status: 500 });
  }
}
