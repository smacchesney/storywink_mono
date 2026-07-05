import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import logger from '@/lib/logger';

// Serialized props cap — telemetry payloads should be tiny.
const MAX_PROPS_BYTES = 2048;

const eventSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_]+$/, 'Event names are snake_case identifiers'),
    bookId: z.string().cuid().optional(),
    props: z.record(z.unknown()).optional(),
  })
  .strict();

/**
 * POST /api/events
 *
 * Funnel telemetry sink. The event is attributed to the authenticated user
 * (client-sent userId is never trusted). bookId is opaque telemetry context,
 * deliberately not ownership-checked.
 */
export async function POST(req: NextRequest) {
  try {
    const { dbUser } = await getAuthenticatedUser();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const parsed = eventSchema.safeParse(body);
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
