import { describe, it, expect, vi, afterEach } from 'vitest';

// The limiter logs fail-open warnings through the app logger, which resolves via
// the Next.js `@/` path alias that vitest does not configure. Stub it so the
// module graph loads without a live logger.
vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { checkRateLimitWith, scheduleKeepalive } from './rateLimit';

// A minimal stub matching the injectable client seam. `status` is mutable so a
// test can flip it mid-call to simulate ioredis re-establishing the stream.
type StubClient = {
  status: string;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
};

function stub(overrides: Partial<StubClient> = {}): StubClient {
  return {
    status: 'ready',
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
}

// The prod failure mode: the first command after an idle disconnect rejects
// with this exact message before ioredis reconnects.
const STREAM_ERR = new Error("Stream isn't writeable and enableOfflineQueue options is false");

describe('checkRateLimitWith — happy path (behavior unchanged)', () => {
  it('increments, sets EXPIRE on the first hit, and returns allowed + remaining', async () => {
    const client = stub({ incr: vi.fn().mockResolvedValue(1) });

    const res = await checkRateLimitWith(client, 'events:u1', 5, 60);

    expect(res).toEqual({ allowed: true, remaining: 4 });
    expect(client.incr).toHaveBeenCalledTimes(1);
    // First hit sets the TTL equal to the window length.
    expect(client.expire).toHaveBeenCalledTimes(1);
    const redisKey = client.incr.mock.calls[0][0] as string;
    expect(redisKey).toMatch(/^ratelimit:events:u1:\d+$/);
    // The key is aligned to a fixed wall-clock window.
    const expectedWindow = Math.floor(Date.now() / 1000 / 60);
    expect(redisKey).toBe(`ratelimit:events:u1:${expectedWindow}`);
    expect(client.expire).toHaveBeenCalledWith(redisKey, 60);
  });

  it('does not set EXPIRE when the window already exists (count > 1)', async () => {
    const client = stub({ incr: vi.fn().mockResolvedValue(3) });

    const res = await checkRateLimitWith(client, 'k', 5, 60);

    expect(res).toEqual({ allowed: true, remaining: 2 });
    expect(client.expire).not.toHaveBeenCalled();
  });

  it('over-limit: count above max → not allowed, remaining clamped at 0', async () => {
    const client = stub({ incr: vi.fn().mockResolvedValue(7) });

    const res = await checkRateLimitWith(client, 'k', 5, 60);

    expect(res).toEqual({ allowed: false, remaining: 0 });
  });
});

describe('checkRateLimitWith — bounded single retry', () => {
  it('first command rejects but client is ready → retries once and returns the real result', async () => {
    const incr = vi
      .fn()
      .mockRejectedValueOnce(STREAM_ERR) // idle-disconnect reject
      .mockResolvedValueOnce(1); // reconnected, retry succeeds
    const client = stub({ status: 'ready', incr });

    const res = await checkRateLimitWith(client, 'k', 5, 60);

    expect(res).toEqual({ allowed: true, remaining: 4 });
    expect(client.incr).toHaveBeenCalledTimes(2);
  });

  it('waits briefly for the client to become ready before retrying', async () => {
    const incr = vi.fn().mockRejectedValueOnce(STREAM_ERR).mockResolvedValueOnce(1);
    const client = stub({ status: 'reconnecting', incr });
    // ioredis reconnects a beat later.
    setTimeout(() => {
      client.status = 'ready';
    }, 30);

    const res = await checkRateLimitWith(client, 'k', 5, 60);

    expect(res).toEqual({ allowed: true, remaining: 4 });
    expect(client.incr).toHaveBeenCalledTimes(2);
  });

  it('both attempts reject → fails open (allowed true, remaining = max)', async () => {
    const incr = vi.fn().mockRejectedValue(STREAM_ERR);
    const client = stub({ status: 'ready', incr });

    const res = await checkRateLimitWith(client, 'k', 5, 60);

    expect(res).toEqual({ allowed: true, remaining: 5 });
    // First attempt + exactly one retry.
    expect(client.incr).toHaveBeenCalledTimes(2);
  });

  it('client never becomes ready → single attempt, fails open, no retry', async () => {
    const incr = vi.fn().mockRejectedValue(STREAM_ERR);
    const client = stub({ status: 'reconnecting', incr });

    const res = await checkRateLimitWith(client, 'k', 5, 60);

    expect(res).toEqual({ allowed: true, remaining: 5 });
    // Never ready within the window, so no retry is attempted.
    expect(client.incr).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleKeepalive', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pings on the interval and swallows ping errors', async () => {
    vi.useFakeTimers();
    const ping = vi.fn().mockRejectedValue(new Error('down'));

    const timer = scheduleKeepalive({ ping });

    // unref'd so keepalive can never hold the process open on its own.
    expect(typeof timer.unref).toBe('function');
    expect(ping).not.toHaveBeenCalled();

    // A rejecting ping must not throw or surface an unhandled rejection.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ping).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ping).toHaveBeenCalledTimes(2);

    clearInterval(timer);
  });
});
