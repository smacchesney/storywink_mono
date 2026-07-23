import { describe, it, expect } from 'vitest';
import { CLIENT_EVENT_NAMES, clientEventSchema } from './client-events';

describe('client event allowlist (POST /api/events schema)', () => {
  it('accepts every name the client track() helper emits', () => {
    for (const name of CLIENT_EVENT_NAMES) {
      const result = clientEventSchema.safeParse({ name });
      expect(result.success, `expected '${name}' to be accepted`).toBe(true);
    }
  });

  it('allowlists the four story-helper funnel events (X8 lesson: unallowlisted track() names 400)', () => {
    for (const name of [
      'story_helper_shown',
      'story_helper_accepted',
      'story_helper_edited',
      'story_helper_skipped',
    ]) {
      expect(CLIENT_EVENT_NAMES).toContain(name);
      expect(clientEventSchema.safeParse({ name }).success, `expected '${name}' accepted`).toBe(
        true,
      );
    }
  });

  it('accepts the X18 wizard funnel events', () => {
    for (const name of ['setup_step_viewed', 'setup_step3_transition'] as const) {
      expect(CLIENT_EVENT_NAMES).toContain(name);
      expect(clientEventSchema.safeParse({ name }).success, `expected '${name}' accepted`).toBe(
        true,
      );
    }
  });

  it('accepts a full payload with bookId and props', () => {
    const result = clientEventSchema.safeParse({
      name: 'preview_opened',
      bookId: 'cm9xka1qb0000abcdxyz01234',
      props: { source: 'library' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects worker-owned control names (the reaper/email/cleanup ledger is unforgeable)', () => {
    const controlNames = [
      'reaper_requeued',
      'reaper_failed',
      'ready_email_sent',
      'draft_sweep_candidate',
      'draft_swept',
      'assets_deleted',
      'assets_delete_dry_run',
      'asset_cleanup_pending',
      'book_finalized',
      'qc_escalated',
      'sheet_generated',
      'sheet_skipped',
    ];
    for (const name of controlNames) {
      const result = clientEventSchema.safeParse({ name });
      expect(result.success, `expected '${name}' to be rejected`).toBe(false);
    }
  });

  it('rejects arbitrary snake_case names (default-deny, not a denylist)', () => {
    expect(clientEventSchema.safeParse({ name: 'some_future_event' }).success).toBe(false);
  });

  it('rejects unknown extra fields (strict object)', () => {
    expect(
      clientEventSchema.safeParse({ name: 'pdf_export', userId: 'someone-else' }).success,
    ).toBe(false);
  });

  it('rejects a non-cuid bookId', () => {
    expect(clientEventSchema.safeParse({ name: 'pdf_export', bookId: 'not-a-cuid' }).success).toBe(
      false,
    );
  });
});
