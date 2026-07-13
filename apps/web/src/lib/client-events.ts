import { z } from 'zod';

/**
 * DEFAULT-DENY allowlist for POST /api/events.
 *
 * AppEvent doubles as the workers' control-plane store, read by (name, bookId)
 * alone: ready-email idempotency ('ready_email_sent'), the reaper's
 * first/second-offense decision ('reaper_requeued'), the draft sweep's
 * flag-once guard ('draft_sweep_candidate'), and the asset-cleanup reconcile
 * pass ('asset_cleanup_pending'). A free-form name field would let any
 * signed-in client forge those rows — suppressing another user's ready email
 * or escalating their stuck book straight to FAILED. So the client sink
 * accepts ONLY the funnel-telemetry names track() actually emits; everything
 * else is a 400 and can never reach the table from a browser. Server-side
 * writers (trackEvent, direct prisma.appEvent.create) do not go through this
 * route and are unaffected.
 *
 * Adding a new client event is a one-line change here — a new worker-owned
 * control name needs NO change (deny by default).
 */
export const CLIENT_EVENT_NAMES = [
  'create_started',
  'create_path_chosen',
  'upload_completed',
  'setup_submitted',
  'preview_opened',
  'pdf_export',
  'print_interest',
  'print_cta_view',
  'print_cta_click',
] as const;

export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

/** Serialized props cap — telemetry payloads should be tiny. */
export const MAX_PROPS_BYTES = 2048;

export const clientEventSchema = z
  .object({
    name: z.enum(CLIENT_EVENT_NAMES),
    bookId: z.string().cuid().optional(),
    props: z.record(z.unknown()).optional(),
  })
  .strict();

export type ClientEventPayload = z.infer<typeof clientEventSchema>;
