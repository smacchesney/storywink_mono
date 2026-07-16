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

  return redis;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
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

  try {
    // Align the key to a fixed wall-clock window so it rolls over and expires
    // on its own.
    const windowStart = Math.floor(Date.now() / 1000 / windowSec);
    const redisKey = `ratelimit:${key}:${windowStart}`;

    const count = await client.incr(redisKey);
    if (count === 1) {
      // First hit in this window — set the TTL so the key self-cleans.
      await client.expire(redisKey, windowSec);
    }

    const remaining = Math.max(0, max - count);
    return { allowed: count <= max, remaining };
  } catch (err) {
    // Fail-open: never block a request because rate limiting itself failed.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), key },
      'Rate limit check failed — allowing request (fail-open)',
    );
    return { allowed: true, remaining: max };
  }
}
