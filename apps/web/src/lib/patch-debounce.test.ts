import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPatchDebouncer, BOOK_PATCH_DEBOUNCE_MS } from './patch-debounce';

describe('createPatchDebouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces rapid queues into one send with merged fields', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const d = createPatchDebouncer(send);
    d.queue({ themeLine: 'a' });
    d.queue({ themeLine: 'ab' });
    d.queue({ eventSummary: 'x' });
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(BOOK_PATCH_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ themeLine: 'ab', eventSummary: 'x' });
  });

  it('flush sends immediately and clears the timer', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const d = createPatchDebouncer(send);
    d.queue({ themeLine: 'a' });
    await d.flush();
    expect(send).toHaveBeenCalledWith({ themeLine: 'a' });
    await vi.advanceTimersByTimeAsync(BOOK_PATCH_DEBOUNCE_MS * 2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('swallows send failures (submit re-sends the full form)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('offline'));
    const d = createPatchDebouncer(send);
    d.queue({ themeLine: 'a' });
    await expect(vi.advanceTimersByTimeAsync(BOOK_PATCH_DEBOUNCE_MS)).resolves.not.toThrow();
  });

  it('flush sends a pending clear ({field: null}) before the timer fires', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const d = createPatchDebouncer(send);
    d.queue({ themeLine: null });
    await d.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ themeLine: null });
    // Pending is empty: no further send when the debounce window elapses.
    await vi.advanceTimersByTimeAsync(BOOK_PATCH_DEBOUNCE_MS * 2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('dispose drops pending fields', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const d = createPatchDebouncer(send);
    d.queue({ themeLine: 'a' });
    d.dispose();
    await vi.advanceTimersByTimeAsync(BOOK_PATCH_DEBOUNCE_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });
});
