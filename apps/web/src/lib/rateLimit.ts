import IORedis from 'ioredis';
import logger from '@/lib/logger';

/**
 * Fixed-window rate limiter backed by the app's existing Redis.
 *
 * Strategy: one counter key per (key, window). INCR on each request; the first
 * request in a window also sets an EXPIRE equal to the window length. When the
 * counter exceeds `max`, the request is over the limit. Windows are aligned to
 * wall-clock buckets (floor(now / windowSec)) so the key rolls over cleanly and
 * self-expires — no background cleanup needed.
 *
 * Fail-open: any Redis error (connection down, timeout, etc.) resolves to
 * `allowed: true`. Rate limiting is a guardrail, not a correctness gate — it
 * must never take the app down when Redis is unavailable.
 */

// Lazy singleton connection, separate from the BullMQ queue connection.
// We deliberately do NOT reuse createBullMQConnection(): its
// maxRetriesPerRequest: null makes every command wait indefinitely when Redis
// is unreachable, which would defeat fail-open. Here we cap retries and disable
// the offline queue so commands reject fast and we fall through to allowed.
let redis: IORedis | null = null;

// Keepalive PING interval. Railway's managed Redis drops idle TCP connections,
// and ioredis defaults to keepAlive: 0 (OS keepalive off), so an idle limiter
// connection silently goes away. A lightweight periodic PING keeps the stream
// warm so the FIRST real command after a quiet period doesn't eat the
// reconnect.
const PING_INTERVAL_MS = 60_000;
let pingTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Schedule a periodic PING that keeps an idle connection alive. Returns the
 * timer so callers (and tests) can clear it. The timer is `unref()`'d so it can
 * never keep the process alive on its own, and PING rejections are swallowed —
 * a failed PING also emits an 'error' event, which the connection error handler
 * already logs.
 */
export function scheduleKeepalive(client: Pick<IORedis, 'ping'>): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    void client.ping().catch(() => {
      // Swallowed: keepalive must never crash the web process. The 'error'
      // event handler on the singleton logs the underlying connection problem.
    });
  }, PING_INTERVAL_MS);
  timer.unref();
  return timer;
}

function getRedis(): IORedis | null {
  if (redis) return redis;

  const url = process.env.REDIS_URL;
  if (!url) {
    // No Redis configured — rate limiting is effectively disabled (fail-open).
    return null;
  }

  redis = new IORedis(url, {
    family: 0, // IPv4+IPv6 for Railway private networking
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
    connectTimeout: 1000,
  });

  // Swallow connection errors so a Redis outage can't crash the web process.
  redis.on('error', (err) => {
    logger.warn({ err: err.message }, 'Rate limiter Redis connection error');
  });

  // Keep the idle connection warm so the first-after-idle command doesn't fail.
  if (!pingTimer) {
    pingTimer = scheduleKeepalive(redis);
  }

  return redis;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Minimal Redis surface the limiter uses. Declared structurally so the counter
 * logic can be exercised against a stub without a live connection. The concrete
 * ioredis client satisfies this.
 */
export interface RateLimitClient {
  status: string;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

// Bounded retry window. On the first-after-idle rejection we wait up to
// RETRY_WAIT_MS for ioredis to re-establish the stream (its default
// retryStrategy reconnects in ~50ms), then retry exactly once. This caps the
// added worst-case latency at ~150ms and never queues or blocks indefinitely.
const RETRY_WAIT_MS = 150;
const READY_POLL_MS = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve true as soon as the client reports 'ready' within `timeoutMs`,
 * otherwise false. Only runs on the (rare) error path, so a short poll is
 * cheaper than wiring up event listeners and is inherently race-free.
 */
async function waitForReady(client: RateLimitClient, timeoutMs: number): Promise<boolean> {
  if (client.status === 'ready') return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(READY_POLL_MS);
    if (client.status === 'ready') return true;
  }
  return false;
}

/**
 * Run one windowed INCR (+ first-hit EXPIRE) and shape the result. Throws on any
 * Redis error so the caller can decide whether to retry or fail open.
 */
async function windowedIncr(
  client: RateLimitClient,
  key: string,
  max: number,
  windowSec: number,
): Promise<RateLimitResult> {
  // Align the key to a fixed wall-clock window so it rolls over and expires on
  // its own.
  const windowStart = Math.floor(Date.now() / 1000 / windowSec);
  const redisKey = `ratelimit:${key}:${windowStart}`;

  const count = await client.incr(redisKey);
  if (count === 1) {
    // First hit in this window — set the TTL so the key self-cleans.
    await client.expire(redisKey, windowSec);
  }

  const remaining = Math.max(0, max - count);
  return { allowed: count <= max, remaining };
}

/**
 * Run the rate-limit check against an explicit client. Extracted from
 * `checkRateLimit` as an injectable seam for testing; behavior is identical.
 */
export async function checkRateLimitWith(
  client: RateLimitClient,
  key: string,
  max: number,
  windowSec: number,
): Promise<RateLimitResult> {
  let lastErr: unknown;
  try {
    return await windowedIncr(client, key, max, windowSec);
  } catch (err) {
    lastErr = err;
  }

  // The dedicated client runs with maxRetriesPerRequest: 1 +
  // enableOfflineQueue: false, so the FIRST command after an idle disconnect
  // rejects ("Stream isn't writeable ...") before ioredis reconnects — exactly
  // the burst-start a limiter exists for. Wait briefly for the reconnect, then
  // retry ONCE. Fail-open semantics are unchanged: if the client never becomes
  // ready, or the single retry also fails, we fall through to allowed below.
  if (await waitForReady(client, RETRY_WAIT_MS)) {
    try {
      return await windowedIncr(client, key, max, windowSec);
    } catch (retryErr) {
      lastErr = retryErr;
    }
  }

  // Fail-open: never block a request because rate limiting itself failed.
  logger.warn(
    { err: lastErr instanceof Error ? lastErr.message : String(lastErr), key },
    'Rate limit check failed — allowing request (fail-open)',
  );
  return { allowed: true, remaining: max };
}

/**
 * Check and increment the rate-limit counter for `key`.
 *
 * @param key        Caller-scoped bucket, e.g. `book-create:<userId>`.
 * @param max        Max requests allowed within the window.
 * @param windowSec  Window length in seconds.
 * @returns          `allowed` false once the count exceeds `max`; `remaining`
 *                   is the number of requests left in the current window
 *                   (clamped at >= 0). Fails open (allowed: true) on any error.
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const client = getRedis();
  if (!client) {
    return { allowed: true, remaining: max };
  }

  return checkRateLimitWith(client, key, max, windowSec);
}
