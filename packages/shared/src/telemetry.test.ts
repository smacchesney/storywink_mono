import { describe, it, expect, vi } from 'vitest';
import { trackEvent, type TelemetryDb } from './telemetry.js';

function fakeDb(create = vi.fn().mockResolvedValue({})) {
  const db: TelemetryDb = { appEvent: { create } };
  return { db, create };
}

describe('trackEvent', () => {
  it('writes name, userId, and bookId, omitting props when absent', async () => {
    const { db, create } = fakeDb();
    await trackEvent(db, { name: 'first_open', userId: 'user-1', bookId: 'book-1' });

    expect(create).toHaveBeenCalledExactlyOnceWith({
      data: { name: 'first_open', userId: 'user-1', bookId: 'book-1' },
    });
  });

  it('nulls missing userId/bookId and passes props through', async () => {
    const { db, create } = fakeDb();
    await trackEvent(db, { name: 'create_started', props: { source: 'landing' } });

    expect(create).toHaveBeenCalledExactlyOnceWith({
      data: { name: 'create_started', userId: null, bookId: null, props: { source: 'landing' } },
    });
  });

  it('swallows write failures and reports them to the logger', async () => {
    const { db } = fakeDb(vi.fn().mockRejectedValue(new Error('db down')));
    const warn = vi.fn();

    await expect(trackEvent(db, { name: 'story_ready' }, { warn })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatchObject({ event: 'story_ready' });
  });

  it('stays silent on failure when no logger is given', async () => {
    const { db } = fakeDb(vi.fn().mockRejectedValue(new Error('db down')));
    await expect(trackEvent(db, { name: 'story_ready' })).resolves.toBeUndefined();
  });
});
