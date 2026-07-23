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

  it('flush awaits an already-running send so submit PATCHes order after it (X18 review #4)', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const send = vi.fn().mockImplementation((body: Record<string, unknown>) => {
      order.push('send:' + Object.keys(body).join(','));
      return new Promise<void>((r) => {
        release = () => {
          order.push('done:' + Object.keys(body).join(','));
          r();
        };
      });
    });
    const d = createPatchDebouncer(send);
    d.queue({ tone: 'sweet' });
    await vi.advanceTimersByTimeAsync(BOOK_PATCH_DEBOUNCE_MS); // timer fires, send in flight
    const flushed = vi.fn();
    const flushPromise = d.flush().then(flushed);
    await Promise.resolve();
    expect(flushed).not.toHaveBeenCalled(); // must wait for the in-flight send
    release();
    await flushPromise;
    expect(flushed).toHaveBeenCalled();
    expect(order).toEqual(['send:tone', 'done:tone']);
  });

  it('an undefined-valued key cancels the pending field entirely (X18 review #4)', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const d = createPatchDebouncer(send);
    d.queue({ childName: 'Kai' });
    d.queue({ childName: undefined });
    await vi.advanceTimersByTimeAsync(BOOK_PATCH_DEBOUNCE_MS * 2);
    expect(send).not.toHaveBeenCalled(); // nothing left to send — no {} PATCH either
  });

  it('serializes overlapping sends in order', async () => {
    const order: string[] = [];
    const resolvers: Array<() => void> = [];
    const send = vi.fn().mockImplementation((body: Record<string, unknown>) => {
      order.push('start:' + Object.keys(body).join(','));
      return new Promise<void>((r) =>
        resolvers.push(() => {
          order.push('end:' + Object.keys(body).join(','));
          r();
        }),
      );
    });
    const d = createPatchDebouncer(send);
    d.queue({ tone: 'sweet' });
    await vi.advanceTimersByTimeAsync(BOOK_PATCH_DEBOUNCE_MS); // send A in flight
    d.queue({ title: 'T' });
    await vi.advanceTimersByTimeAsync(BOOK_PATCH_DEBOUNCE_MS); // timer B fires while A running
    resolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    resolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['start:tone', 'end:tone', 'start:title', 'end:title']);
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
