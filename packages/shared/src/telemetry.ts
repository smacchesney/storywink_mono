/**
 * Product funnel telemetry — one thin helper shared by web and workers.
 *
 * Writes an AppEvent row and never throws: a failed telemetry write must
 * never break the user-facing operation that emitted it.
 */

export interface TrackedEvent {
  name: string;
  userId?: string;
  bookId?: string;
  props?: Record<string, unknown>;
}

// Minimal structural view of a Prisma client so both the web and workers
// clients satisfy it without this package depending on @prisma/client.
export interface TelemetryDb {
  appEvent: {
    create(args: {
      data: {
        name: string;
        userId?: string | null;
        bookId?: string | null;
        props?: unknown;
      };
    }): Promise<unknown>;
  };
}

// Pino-shaped; optional so callers without a logger stay silent.
export interface TelemetryLogger {
  warn(obj: unknown, msg?: string): void;
}

export async function trackEvent(
  db: TelemetryDb,
  event: TrackedEvent,
  logger?: TelemetryLogger,
): Promise<void> {
  try {
    await db.appEvent.create({
      data: {
        name: event.name,
        userId: event.userId ?? null,
        bookId: event.bookId ?? null,
        ...(event.props !== undefined ? { props: event.props } : {}),
      },
    });
  } catch (error) {
    logger?.warn({ error, event: event.name }, 'Telemetry write failed');
  }
}
