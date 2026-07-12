/**
 * Backfill waving cutouts for avatars that predate X7.
 *
 * Enqueues one {cutoutOnly: true} avatar-rendition job per READY rendition
 * with no cutoutUrl. The worker generates ONLY the cutout from the existing
 * sheet — no PENDING flip, no working-state on the card; the cutout swaps in
 * silently when it lands. Idempotent: renditions with a cutout are skipped
 * here, and the worker re-checks before spending.
 *
 * Run:  npx tsx scripts/backfill-avatar-cutouts.ts          (dry-run report)
 *       npx tsx scripts/backfill-avatar-cutouts.ts --apply  (enqueue jobs)
 *
 * Requires DATABASE_URL and REDIS_URL in the environment (the WORKERS
 * service's values when running against prod — the jobs execute there).
 */
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// Root scripts run CJS, and @storywink/shared exports are ESM-only — so the
// queue name (QUEUE_NAMES.AVATAR_RENDITION) and the Railway-safe connection
// shape (createBullMQConnection) are mirrored here instead of imported.
const AVATAR_RENDITION_QUEUE = 'avatar-rendition';

function bullConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    family: 0 as const, // IPv4+IPv6 for Railway private networking
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

async function main() {
  const renditions = await prisma.avatarRendition.findMany({
    where: { status: 'READY', cutoutUrl: null, turnaroundSheetUrl: { not: null } },
    select: {
      id: true,
      artStyle: true,
      avatar: { select: { id: true, userId: true, displayName: true, identity: true } },
    },
  });
  console.log(`${renditions.length} READY renditions missing a cutout${APPLY ? '' : ' (dry run)'}`);

  const actionable = renditions.filter((r) => {
    if (!r.avatar.identity) {
      console.warn(
        `  skipping ${r.avatar.displayName} (${r.artStyle}) — no stored identity to prompt from`,
      );
      return false;
    }
    return true;
  });

  if (!APPLY) {
    for (const r of actionable) {
      console.log(`  would enqueue: ${r.avatar.displayName} (${r.artStyle})`);
    }
    return;
  }

  const queue = new Queue(AVATAR_RENDITION_QUEUE, {
    connection: bullConnection(),
  });
  try {
    for (const r of actionable) {
      const jobId = `cutout-backfill-${r.avatar.id}-${r.artStyle}`;
      await queue.add(
        jobId,
        {
          avatarId: r.avatar.id,
          userId: r.avatar.userId,
          artStyle: r.artStyle,
          cutoutOnly: true,
        },
        // Deterministic jobId: re-running the script while a prior job is still
        // queued/active is a no-op instead of a double Gemini spend for the
        // same rendition. removeOnComplete/Fail delete the job hash the instant
        // it finishes so a straggler re-run (a cutout that came back null and
        // is still missing) actually re-enqueues — without these, BullMQ
        // retains the completed hash forever and silently drops every re-run.
        {
          jobId,
          attempts: 2,
          backoff: { type: 'exponential', delay: 10000 },
          removeOnComplete: true,
          removeOnFail: true,
          // Backfill yields to live jobs: BullMQ serves non-prioritized adds
          // (every user-facing enqueue) before ANY prioritized job, so a big
          // backfill can't back up draw-again/batch renditions for an hour —
          // which would also trip the route's 10-minute stale-PENDING escape
          // hatch into duplicate spends.
          priority: 10,
        },
      );
      console.log(`  enqueued: ${r.avatar.displayName} (${r.artStyle})`);
    }
    console.log(`${actionable.length} cutout jobs enqueued`);
  } finally {
    await queue.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
