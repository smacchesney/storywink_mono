/**
 * Shared plumbing for the avatar (character library) routes.
 * Every avatar surface is dark behind AVATARS_ENABLED until X6 goes live.
 */
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@storywink/shared/constants';
import { createBullMQConnection } from '@storywink/shared/redis';

export function avatarsEnabled(): boolean {
  return process.env.AVATARS_ENABLED === 'true';
}

/** Maps a perception roster role onto the avatar kind for promotion. */
export function kindForRole(role: string): 'CHILD' | 'ADULT' | 'PET' | 'TOY' {
  if (role === 'main_child' || role.startsWith('main')) return 'CHILD';
  if (role === 'pet') return 'PET';
  if (role === 'companion_object') return 'TOY';
  return 'ADULT';
}

let cleanupQueue: Queue | null = null;
/** Lazy singleton — same pattern as the book-deletion route. */
export function getAvatarCleanupQueue(): Queue {
  if (!cleanupQueue) {
    cleanupQueue = new Queue(QUEUE_NAMES.ASSET_CLEANUP, {
      connection: createBullMQConnection(),
    });
  }
  return cleanupQueue;
}
