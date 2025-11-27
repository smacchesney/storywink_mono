/**
 * Redis connection configuration for Railway private networking.
 *
 * Railway's private network uses IPv6 only. By default, ioredis attempts
 * IPv4 connections which fail because redis.railway.internal only resolves
 * to an IPv6 address. Setting family: 0 tells Node.js to try both.
 *
 * @see https://docs.railway.com/guides/private-networking#ioredis
 */

export interface BullMQConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  family: 0; // IPv4+IPv6 for Railway private networking
  maxRetriesPerRequest: null; // Required for BullMQ
  enableReadyCheck: boolean;
}

/**
 * Parse REDIS_URL and return BullMQ-compatible connection options
 * with IPv6 support for Railway private networking.
 *
 * @param redisUrl - Optional Redis URL. Defaults to process.env.REDIS_URL
 * @returns Connection options object for ioredis/BullMQ
 * @throws Error if REDIS_URL is not set
 *
 * @example
 * ```typescript
 * import Redis from 'ioredis';
 * import { createBullMQConnection } from '@storywink/shared/redis';
 *
 * const redis = new Redis(createBullMQConnection());
 * ```
 */
export function createBullMQConnection(
  redisUrl?: string
): BullMQConnectionOptions {
  const url = redisUrl || process.env.REDIS_URL;

  if (!url) {
    throw new Error('REDIS_URL environment variable is not set');
  }

  const parsed = new URL(url);

  return {
    family: 0, // Critical: enables IPv6 for Railway private networking
    host: parsed.hostname,
    port: parseInt(parsed.port) || 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
  };
}
