// ============================================================================
// CRITICAL: Force unbuffered I/O for Railway real-time logging
// Build trigger: 2024-11-30
// ============================================================================
// Node.js buffers stdout/stderr by default, causing logs from fast-failing
// jobs to be lost when the process terminates before the buffer flushes.
// This forces synchronous, unbuffered writes so Railway captures all logs.
// Must be set BEFORE any imports that might write to stdout/stderr.
// ============================================================================
if ((process.stdout as any)._handle?.setBlocking) {
  (process.stdout as any)._handle.setBlocking(true);
}
if ((process.stderr as any)._handle?.setBlocking) {
  (process.stderr as any)._handle.setBlocking(true);
}

// Disable Pino's internal buffering for immediate log writes
process.env.PINO_NO_BUFFER = 'true';

import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import { config } from 'dotenv';
import * as Sentry from '@sentry/node';
import { QUEUE_NAMES } from '@storywink/shared/constants';
import { createBullMQConnection } from '@storywink/shared/redis';
import pino from 'pino';
import crypto from 'crypto';

// Load environment variables
// In a monorepo setup with Turbo, the working directory is set to the package directory
// Load from .env in the current directory (apps/workers/.env)
const result = config();
console.log('Environment loading result:', result.error ? 'Error' : 'Success');
if (result.error) {
  console.error('Error loading .env:', result.error);
}

// Verify critical environment variables are loaded
const requiredEnvVars = ['REDIS_URL', 'GOOGLE_API_KEY', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('Missing required environment variables:', missingVars);
  process.exit(1);
} else {
  console.log('All required environment variables loaded successfully');
}

// Create logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

// Initialize Sentry error monitoring.
// Silent no-op when SENTRY_DSN is unset (local dev, CI): we skip init entirely,
// so every Sentry.captureException call downstream becomes a harmless no-op.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 0,
  });
  logger.info('Sentry initialized for workers');
}

// Create Redis connection with BullMQ-specific options
// Uses family: 0 for IPv6 support on Railway private networking
const redis = new Redis(createBullMQConnection());

// Handle Redis connection errors gracefully (prevent process crash)
redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

redis.on('close', () => {
  console.warn('[Redis] Connection closed, will attempt to reconnect...');
});

redis.on('reconnecting', () => {
  console.info('[Redis] Reconnecting...');
});

// Import worker processors
import { processStoryGeneration } from './workers/story-generation.worker.js';
import { processIllustrationGeneration } from './workers/illustration-generation.worker.js';
import { processBookFinalize } from './workers/book-finalize.worker.js';
import { processPrintFulfillment } from './workers/print-fulfillment.worker.js';
import { processCharacterExtraction } from './workers/character-extraction.worker.js';
import { processPhotoAnalysis } from './workers/photo-analysis.worker.js';
import { processBookReaper } from './workers/book-reaper.worker.js';
import { REAPER_INTERVAL_MS } from './workers/book-reaper.helpers.js';
import { processLuluStatusPoll } from './workers/lulu-status-poll.worker.js';
import { LULU_POLL_INTERVAL_MS } from './workers/lulu-status-poll.helpers.js';
import { processAssetCleanup } from './workers/asset-cleanup.worker.js';
import {
  DRAFT_SWEEP_JOB_NAME,
  DRAFT_SWEEP_INTERVAL_MS,
} from './workers/asset-cleanup.helpers.js';
import { getIllustrator } from './lib/illustrators/index.js';

// CRITICAL: Pre-load and validate STYLE_LIBRARY before processing any jobs
// This prevents race conditions where workers access STYLE_LIBRARY before it's fully loaded
import { STYLE_LIBRARY } from '@storywink/shared/prompts/styles';

// Validate STYLE_LIBRARY is properly loaded at startup
function validateStyleLibrary() {
  console.log('[Startup] Validating STYLE_LIBRARY...');

  if (!STYLE_LIBRARY || Object.keys(STYLE_LIBRARY).length === 0) {
    console.error('[Startup] FATAL: STYLE_LIBRARY is not loaded!');
    process.exit(1);
  }

  // Validate each style has required properties
  for (const [key, value] of Object.entries(STYLE_LIBRARY)) {
    if (!value.referenceImageUrls || value.referenceImageUrls.length === 0) {
      console.error(`[Startup] FATAL: Style "${key}" missing referenceImageUrls`);
      process.exit(1);
    }
    console.log(`[Startup] ✓ Style "${key}" loaded with ${value.referenceImageUrls.length} reference images`);
  }

  console.log(`[Startup] ✓ STYLE_LIBRARY validated successfully (${Object.keys(STYLE_LIBRARY).length} styles)`);
}

// Run validation immediately at module load
validateStyleLibrary();
console.log('[Startup] styles module URL:', import.meta.url);
console.log('[Startup] referenceImageUrls count:', STYLE_LIBRARY.vignette?.referenceImageUrls.length);

// ============================================================================
// DIAGNOSTIC: Deep freeze STYLE_LIBRARY to detect mutations
// ============================================================================
// This freezes the object and all nested objects. If any code tries to modify
// STYLE_LIBRARY at runtime, it will throw an error immediately, helping us
// identify if mutation is the root cause.

function deepFreeze(obj: any): void {
  // Freeze the top-level object
  Object.freeze(obj);

  // Recursively freeze all nested objects
  Object.values(obj).forEach(value => {
    if (typeof value === 'object' && value !== null) {
      deepFreeze(value);
    }
  });
}

// Apply deep freeze to prevent any mutations
deepFreeze(STYLE_LIBRARY);

// Validate illustration provider config at startup — throws on misconfiguration
// so a misdeployed worker fails immediately rather than on first job.
getIllustrator();

// Generate unique instance ID to track which worker processes which job
const INSTANCE_ID = crypto.randomUUID();
// Make it available as env var for diagnostic logging
process.env.INSTANCE_ID = INSTANCE_ID;

// Generate SHA256 hash of the STYLE_LIBRARY for verification
// This lets us confirm all containers are running the same code
const styleLibraryHash = crypto
  .createHash('sha256')
  .update(JSON.stringify(STYLE_LIBRARY))
  .digest('hex');

console.log('='.repeat(80));
console.log('[DIAGNOSTIC] STYLE_LIBRARY Protection Applied');
console.log('='.repeat(80));
console.log(`[Startup] Instance ID: ${INSTANCE_ID}`);
console.log(`[Startup] STYLE_LIBRARY frozen and verified`);
console.log(`[Startup] SHA256 Hash: ${styleLibraryHash}`);
console.log(`[Startup] Process PID: ${process.pid}`);
console.log(`[Startup] Hostname: ${process.env.HOSTNAME || 'unknown'}`);
console.log(`[Startup] Node Version: ${process.version}`);
console.log(`[Startup] Railway Commit: ${process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown'}`);
console.log(`[Startup] Git Commit: ${process.env.GIT_COMMIT_SHA || 'unknown'}`);
console.log('='.repeat(80));

// Concurrency configuration - can be overridden via environment variables
// Set ILLUSTRATION_CONCURRENCY=1 for debugging to ensure single worker processes all jobs
const STORY_CONCURRENCY = parseInt(process.env.STORY_CONCURRENCY || '2', 10);
const ILLUSTRATION_CONCURRENCY = parseInt(process.env.ILLUSTRATION_CONCURRENCY || '3', 10);
const FINALIZE_CONCURRENCY = parseInt(process.env.FINALIZE_CONCURRENCY || '2', 10);
const PRINT_FULFILLMENT_CONCURRENCY = parseInt(process.env.PRINT_FULFILLMENT_CONCURRENCY || '1', 10);
// Default 2 (was 1): character sheet generation (CHARACTER_SHEETS_ENABLED)
// can put up to ~60s of image-gen work into this stage, and a single lane
// would head-of-line block book B's whole illustration pipeline behind
// book A's sheets. Env-overridable like ILLUSTRATION_CONCURRENCY.
const CHARACTER_EXTRACTION_CONCURRENCY = parseInt(process.env.CHARACTER_EXTRACTION_CONCURRENCY || '2', 10);

console.log(`[Startup] Concurrency settings:`);
console.log(`  - Story: ${STORY_CONCURRENCY}`);
console.log(`  - Illustration: ${ILLUSTRATION_CONCURRENCY}`);
console.log(`  - Finalize: ${FINALIZE_CONCURRENCY}`);
console.log(`  - Print Fulfillment: ${PRINT_FULFILLMENT_CONCURRENCY}`);
console.log(`  - Character Extraction: ${CHARACTER_EXTRACTION_CONCURRENCY}`);

// Create workers
const storyWorker = new Worker(
  QUEUE_NAMES.STORY_GENERATION,
  processStoryGeneration,
  {
    connection: redis,
    concurrency: STORY_CONCURRENCY,
    lockDuration: 300000, // 5 minutes for multi-image vision API calls
  }
);

const illustrationWorker = new Worker(
  QUEUE_NAMES.ILLUSTRATION_GENERATION,
  processIllustrationGeneration,
  {
    connection: redis,
    concurrency: ILLUSTRATION_CONCURRENCY,
    lockDuration: 300000,  // 5 minutes (handles 100s+ API + upload times safely)
    maxStalledCount: 0,    // Disable auto-retry on stall (prevents duplicate processing)
  }
);

const finalizeWorker = new Worker(
  QUEUE_NAMES.BOOK_FINALIZE,
  processBookFinalize,
  {
    connection: redis,
    concurrency: FINALIZE_CONCURRENCY,
  }
);

const printFulfillmentWorker = new Worker(
  QUEUE_NAMES.PRINT_FULFILLMENT,
  processPrintFulfillment,
  {
    connection: redis,
    concurrency: PRINT_FULFILLMENT_CONCURRENCY,
    lockDuration: 600000, // 10 minutes for PDF generation + upload + Lulu submission
  }
);

const characterExtractionWorker = new Worker(
  QUEUE_NAMES.CHARACTER_EXTRACTION,
  processCharacterExtraction,
  {
    connection: redis,
    concurrency: CHARACTER_EXTRACTION_CONCURRENCY,
    lockDuration: 300000, // 5 minutes for multi-image vision analysis
  }
);

const photoAnalysisWorker = new Worker(
  QUEUE_NAMES.PHOTO_ANALYSIS,
  processPhotoAnalysis,
  {
    connection: redis,
    concurrency: parseInt(process.env.PHOTO_ANALYSIS_CONCURRENCY || '2', 10),
    lockDuration: 300000, // 5 minutes for multi-image vision analysis
  }
);

const bookReaperWorker = new Worker(
  QUEUE_NAMES.BOOK_REAPER,
  processBookReaper,
  {
    connection: redis,
    concurrency: 1, // sweeps must never overlap
  }
);

const luluStatusPollWorker = new Worker(
  QUEUE_NAMES.LULU_STATUS_POLL,
  processLuluStatusPoll,
  {
    connection: redis,
    concurrency: 1, // sweeps must never overlap
  }
);

const assetCleanupWorker = new Worker(
  QUEUE_NAMES.ASSET_CLEANUP,
  processAssetCleanup,
  {
    connection: redis,
    concurrency: 1, // serializes the draft sweep with deletion jobs
    lockDuration: 300000, // 5 minutes: large accounts mean many Admin API calls
  }
);

// Repeatable schedule for the stuck-book reaper. upsertJobScheduler is
// idempotent across restarts/redeploys (same scheduler id replaces the old
// schedule), so every boot converges on one sweep per interval.
const bookReaperQueue = new Queue(QUEUE_NAMES.BOOK_REAPER, {
  connection: createBullMQConnection(),
});
bookReaperQueue
  .upsertJobScheduler(
    'book-reaper-sweep',
    { every: REAPER_INTERVAL_MS },
    {
      name: 'reap-stuck-books',
      opts: {
        removeOnComplete: { count: 24 },
        removeOnFail: { count: 50 },
      },
    }
  )
  .then(() => {
    logger.info({ everyMs: REAPER_INTERVAL_MS }, 'Book reaper sweep scheduled');
  })
  .catch((err: Error) => {
    // Scheduling failure must not crash the other workers; the next deploy or
    // restart retries the upsert.
    logger.error({ error: err.message }, 'Failed to schedule book reaper sweep');
  });

// Repeatable schedule for the Lulu order-status poller (same idempotent
// upsertJobScheduler pattern as the reaper above).
const luluStatusPollQueue = new Queue(QUEUE_NAMES.LULU_STATUS_POLL, {
  connection: createBullMQConnection(),
});
luluStatusPollQueue
  .upsertJobScheduler(
    'lulu-status-poll-sweep',
    { every: LULU_POLL_INTERVAL_MS },
    {
      name: 'poll-lulu-status',
      opts: {
        removeOnComplete: { count: 24 },
        removeOnFail: { count: 50 },
      },
    }
  )
  .then(() => {
    logger.info({ everyMs: LULU_POLL_INTERVAL_MS }, 'Lulu status poll scheduled');
  })
  .catch((err: Error) => {
    // Scheduling failure must not crash the other workers; the next deploy or
    // restart retries the upsert.
    logger.error({ error: err.message }, 'Failed to schedule Lulu status poll');
  });

// Repeatable schedule for the draft-retention sweep (same idempotent
// upsertJobScheduler pattern as the reaper above). The sweep job shares the
// asset-cleanup queue with enqueued deletion jobs; the processor branches on
// the job name.
const assetCleanupQueue = new Queue(QUEUE_NAMES.ASSET_CLEANUP, {
  connection: createBullMQConnection(),
});
assetCleanupQueue
  .upsertJobScheduler(
    'draft-retention-sweep-schedule',
    { every: DRAFT_SWEEP_INTERVAL_MS },
    {
      name: DRAFT_SWEEP_JOB_NAME,
      opts: {
        removeOnComplete: { count: 24 },
        removeOnFail: { count: 50 },
      },
    }
  )
  .then(() => {
    logger.info({ everyMs: DRAFT_SWEEP_INTERVAL_MS }, 'Draft retention sweep scheduled');
  })
  .catch((err: Error) => {
    // Scheduling failure must not crash the other workers; the next deploy or
    // restart retries the upsert.
    logger.error({ error: err.message }, 'Failed to schedule draft retention sweep');
  });

// Worker event handlers
storyWorker.on('active', (job) => {
  console.log(`[StoryWorker] Job ${job.id} started for book ${job.data.bookId}`);
  console.log(`  - Instance ID: ${INSTANCE_ID}`);
  console.log(`  - Process PID: ${process.pid}`);
});

storyWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, bookId: job.data.bookId }, 'Story generation completed');
  console.log(`[StoryWorker] Completed job ${job.id} for book ${job.data.bookId}`);
});

storyWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Story generation failed');
  Sentry.captureException(err, {
    tags: { worker: 'story-generation', jobId: job?.id },
    extra: { bookId: job?.data?.bookId, attempts: job?.attemptsMade },
  });
  console.error('='.repeat(80));
  console.error(`[StoryWorker] FAILED JOB ${job?.id}`);
  console.error('='.repeat(80));
  console.error(`  Instance ID: ${INSTANCE_ID}`);
  console.error(`  Process PID: ${process.pid}`);
  console.error(`  Hostname: ${process.env.HOSTNAME || 'unknown'}`);
  console.error(`  STYLE_LIBRARY Hash: ${styleLibraryHash}`);
  console.error(`  Book ID: ${job?.data?.bookId}`);
  console.error(`  Error: ${err.message}`);
  console.error(`  Stack Trace:`);
  console.error(err.stack);
  console.error('='.repeat(80));
});

illustrationWorker.on('active', (job) => {
  console.log(`[IllustrationWorker] Job ${job.id} started:`)
  console.log(`  - Instance ID: ${INSTANCE_ID}`)
  console.log(`  - Process PID: ${process.pid}`)
  console.log(`  - Book: ${job.data.bookId}`)
  console.log(`  - Page: ${job.data.pageNumber}`)
  console.log(`  - Style: ${job.data.artStyle || 'unknown'}`)
  console.log(`  - Parent Job: ${job.parent?.id || 'None'}`)
});

illustrationWorker.on('progress', (job, progress) => {
  console.log(`[IllustrationWorker] Job ${job.id} progress: ${JSON.stringify(progress)}`);
});

illustrationWorker.on('completed', (job) => {
  logger.info({ 
    jobId: job.id, 
    pageId: job.data.pageId,
    pageNumber: job.data.pageNumber,
    bookId: job.data.bookId,
    parentJobId: job.parent?.id
  }, 'Illustration generation completed');
  console.log(`[IllustrationWorker] Completed job ${job.id}:`)
  console.log(`  - Book: ${job.data.bookId}`)
  console.log(`  - Page: ${job.data.pageNumber}`)
  console.log(`  - Parent Job: ${job.parent?.id || 'None'}`)
});

illustrationWorker.on('failed', (job, err) => {
  const failureStage = (err.message.includes('Gemini') || err.message.includes('Google') ||
                        err.message.includes('OpenAI') || err.message.includes('gpt-image')) ? 'ai_generation' :
                      err.message.includes('Cloudinary') ? 'image_upload' :
                      err.message.includes('fetch') ? 'image_fetch' :
                      err.message.includes('database') ? 'database_update' :
                      err.message.includes('referenceImageUrl') ? 'style_library_lookup' : 'unknown';

  logger.error({
    jobId: job?.id,
    error: err.message,
    errorStack: err.stack,
    pageId: job?.data?.pageId,
    pageNumber: job?.data?.pageNumber,
    bookId: job?.data?.bookId,
    parentJobId: job?.parent?.id,
    attempts: job?.attemptsMade,
    maxAttempts: job?.opts?.attempts,
    failureStage,
    willRetry: (job?.attemptsMade || 0) < (job?.opts?.attempts || 1)
  }, 'Illustration generation failed');

  Sentry.captureException(err, {
    tags: { worker: 'illustration-generation', jobId: job?.id, failureStage },
    extra: {
      bookId: job?.data?.bookId,
      pageId: job?.data?.pageId,
      pageNumber: job?.data?.pageNumber,
      attempts: job?.attemptsMade,
    },
  });

  console.error('='.repeat(80));
  console.error(`[IllustrationWorker] FAILED JOB ${job?.id}`);
  console.error('='.repeat(80));
  console.error(`  CRITICAL: This failed event handler runs OUTSIDE the job processor`);
  console.error(`  If you see this but NO logs from processIllustrationGeneration,`);
  console.error(`  then this job was processed by a different container/instance!`);
  console.error('');
  console.error(`  Instance ID: ${INSTANCE_ID}`);
  console.error(`  Process PID: ${process.pid}`);
  console.error(`  Hostname: ${process.env.HOSTNAME || 'unknown'}`);
  console.error(`  Node Version: ${process.version}`);
  console.error(`  STYLE_LIBRARY Hash: ${styleLibraryHash}`);
  console.error(`  Railway Commit: ${process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown'}`);
  console.error('');
  console.error(`  Job Details:`);
  console.error(`    - Job ID: ${job?.id}`);
  console.error(`    - Book ID: ${job?.data?.bookId}`);
  console.error(`    - Page Number: ${job?.data?.pageNumber}`);
  console.error(`    - Page ID: ${job?.data?.pageId}`);
  console.error(`    - Parent Job: ${job?.parent?.id || 'None'}`);
  console.error(`    - Style: ${job?.data?.artStyle || 'unknown'}`);
  console.error('');
  console.error(`  Error Details:`);
  console.error(`    - Message: ${err.message}`);
  console.error(`    - Failure Stage: ${failureStage}`);
  console.error(`    - Attempts: ${job?.attemptsMade}/${job?.opts?.attempts || 'unknown'}`);
  console.error(`    - Will Retry: ${(job?.attemptsMade || 0) < (job?.opts?.attempts || 1)}`);
  console.error('');
  console.error(`  Full Stack Trace:`);
  console.error(err.stack);
  console.error('='.repeat(80));
});

finalizeWorker.on('active', (job) => {
  console.log(`[FinalizeWorker] Started finalization job ${job.id} for book ${job.data.bookId}`);
  console.log(`  - Instance ID: ${INSTANCE_ID}`);
  console.log(`  - Process PID: ${process.pid}`);
  console.log(`  - Waiting for child jobs to complete...`);
});

finalizeWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, bookId: job.data.bookId }, 'Book finalization completed');
  console.log(`[FinalizeWorker] Completed finalization job ${job.id} for book ${job.data.bookId}`);
});

finalizeWorker.on('failed', (job, err) => {
  logger.error({
    jobId: job?.id,
    error: err.message,
    bookId: job?.data?.bookId,
    attempts: job?.attemptsMade
  }, 'Book finalization failed');
  Sentry.captureException(err, {
    tags: { worker: 'book-finalize', jobId: job?.id },
    extra: { bookId: job?.data?.bookId, attempts: job?.attemptsMade },
  });
  console.error('='.repeat(80));
  console.error(`[FinalizeWorker] FAILED JOB ${job?.id}`);
  console.error('='.repeat(80));
  console.error(`  Instance ID: ${INSTANCE_ID}`);
  console.error(`  Process PID: ${process.pid}`);
  console.error(`  Hostname: ${process.env.HOSTNAME || 'unknown'}`);
  console.error(`  STYLE_LIBRARY Hash: ${styleLibraryHash}`);
  console.error(`  Book ID: ${job?.data?.bookId}`);
  console.error(`  Error: ${err.message}`);
  console.error(`  Attempts: ${job?.attemptsMade}`);
  console.error(`  Stack Trace:`);
  console.error(err.stack);
  console.error('='.repeat(80));
});

// Print Fulfillment Worker event handlers
printFulfillmentWorker.on('active', (job) => {
  console.log(`[PrintFulfillmentWorker] Job ${job.id} started for order ${job.data.printOrderId}`);
  console.log(`  - Instance ID: ${INSTANCE_ID}`);
  console.log(`  - Process PID: ${process.pid}`);
  console.log(`  - Book ID: ${job.data.bookId}`);
});

printFulfillmentWorker.on('progress', (job, progress) => {
  console.log(`[PrintFulfillmentWorker] Job ${job.id} progress:`, JSON.stringify(progress));
});

printFulfillmentWorker.on('completed', (job) => {
  logger.info({
    jobId: job.id,
    printOrderId: job.data.printOrderId,
    bookId: job.data.bookId,
  }, 'Print fulfillment completed');
  console.log(`[PrintFulfillmentWorker] Completed job ${job.id} for order ${job.data.printOrderId}`);
});

printFulfillmentWorker.on('failed', (job, err) => {
  logger.error({
    jobId: job?.id,
    error: err.message,
    printOrderId: job?.data?.printOrderId,
    bookId: job?.data?.bookId,
    attempts: job?.attemptsMade
  }, 'Print fulfillment failed');
  Sentry.captureException(err, {
    tags: { worker: 'print-fulfillment', jobId: job?.id },
    extra: {
      printOrderId: job?.data?.printOrderId,
      bookId: job?.data?.bookId,
      attempts: job?.attemptsMade,
    },
  });
  console.error('='.repeat(80));
  console.error(`[PrintFulfillmentWorker] FAILED JOB ${job?.id}`);
  console.error('='.repeat(80));
  console.error(`  Instance ID: ${INSTANCE_ID}`);
  console.error(`  Process PID: ${process.pid}`);
  console.error(`  Hostname: ${process.env.HOSTNAME || 'unknown'}`);
  console.error(`  Order ID: ${job?.data?.printOrderId}`);
  console.error(`  Book ID: ${job?.data?.bookId}`);
  console.error(`  Error: ${err.message}`);
  console.error(`  Attempts: ${job?.attemptsMade}`);
  console.error(`  Stack Trace:`);
  console.error(err.stack);
  console.error('='.repeat(80));
});

// Character Extraction Worker event handlers
characterExtractionWorker.on('active', (job) => {
  console.log(`[CharacterExtractionWorker] Job ${job.id} started for book ${job.data.bookId}`);
  console.log(`  - Instance ID: ${INSTANCE_ID}`);
  console.log(`  - Process PID: ${process.pid}`);
  console.log(`  - Art Style: ${job.data.artStyle}`);
});

characterExtractionWorker.on('completed', (job) => {
  logger.info({
    jobId: job.id,
    bookId: job.data.bookId,
    characterCount: job.returnvalue?.characterCount ?? 0,
  }, 'Character extraction completed');
  console.log(`[CharacterExtractionWorker] Completed job ${job.id} for book ${job.data.bookId}`);
});

characterExtractionWorker.on('failed', (job, err) => {
  logger.error({
    jobId: job?.id,
    error: err.message,
    bookId: job?.data?.bookId,
    attempts: job?.attemptsMade,
  }, 'Character extraction failed');
  Sentry.captureException(err, {
    tags: { worker: 'character-extraction', jobId: job?.id },
    extra: { bookId: job?.data?.bookId, attempts: job?.attemptsMade },
  });
  console.error('='.repeat(80));
  console.error(`[CharacterExtractionWorker] FAILED JOB ${job?.id}`);
  console.error('='.repeat(80));
  console.error(`  Instance ID: ${INSTANCE_ID}`);
  console.error(`  Process PID: ${process.pid}`);
  console.error(`  Book ID: ${job?.data?.bookId}`);
  console.error(`  Error: ${err.message}`);
  console.error(`  Attempts: ${job?.attemptsMade}`);
  console.error(`  Stack Trace:`);
  console.error(err.stack);
  console.error('='.repeat(80));
});

// Photo Analysis Worker event handlers
photoAnalysisWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, bookId: job.data.bookId }, 'Photo perception pass completed');
});

photoAnalysisWorker.on('failed', (job, err) => {
  // Non-fatal for the book: story generation degrades gracefully without analysis.
  logger.error({
    jobId: job?.id,
    bookId: job?.data?.bookId,
    error: err.message,
    attempts: job?.attemptsMade,
  }, 'Photo perception pass failed');
});

// Book Reaper Worker event handlers
bookReaperWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, result: job.returnvalue }, 'Book reaper sweep completed');
});

bookReaperWorker.on('failed', (job, err) => {
  // The processor swallows its own errors, so this only fires on infra-level
  // failures (lost lock, Redis hiccup). The next scheduled sweep retries.
  logger.error({ jobId: job?.id, error: err.message }, 'Book reaper sweep job failed');
});

// Lulu Status Poll Worker event handlers
luluStatusPollWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, result: job.returnvalue }, 'Lulu status poll sweep completed');
});

luluStatusPollWorker.on('failed', (job, err) => {
  // The processor swallows its own errors, so this only fires on infra-level
  // failures (lost lock, Redis hiccup). The next scheduled sweep retries.
  logger.error({ jobId: job?.id, error: err.message }, 'Lulu status poll sweep job failed');
});

// Asset Cleanup Worker event handlers
assetCleanupWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, jobName: job.name, result: job.returnvalue }, 'Asset cleanup job completed');
});

assetCleanupWorker.on('failed', (job, err) => {
  // Deletion jobs rethrow Cloudinary API errors so BullMQ retries them; the
  // sweep swallows its own errors, so sweep failures here are infra-level.
  logger.error(
    {
      jobId: job?.id,
      jobName: job?.name,
      bookId: job?.data?.bookId,
      userId: job?.data?.userId,
      reason: job?.data?.reason,
      attempts: job?.attemptsMade,
      error: err.message,
    },
    'Asset cleanup job failed',
  );
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down workers...');

  await storyWorker.close();
  await illustrationWorker.close();
  await finalizeWorker.close();
  await printFulfillmentWorker.close();
  await characterExtractionWorker.close();
  await photoAnalysisWorker.close();
  await bookReaperWorker.close();
  await bookReaperQueue.close();
  await luluStatusPollWorker.close();
  await luluStatusPollQueue.close();
  await assetCleanupWorker.close();
  await assetCleanupQueue.close();
  await redis.quit();

  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

logger.info('Workers started successfully - v2.1.0');
console.log('='.repeat(80));
console.log('[Workers] All workers started and listening for jobs');
console.log('='.repeat(80));
console.log(`Instance ID: ${INSTANCE_ID}`);
console.log(`Process PID: ${process.pid}`);
console.log('');
console.log('[Workers] Configuration:');
console.log(`  - Story Worker: concurrency=${STORY_CONCURRENCY}`);
console.log(`  - Illustration Worker: concurrency=${ILLUSTRATION_CONCURRENCY}`);
console.log(`  - Finalize Worker: concurrency=${FINALIZE_CONCURRENCY}`);
console.log(`  - Print Fulfillment Worker: concurrency=${PRINT_FULFILLMENT_CONCURRENCY}`);
console.log(`  - Character Extraction Worker: concurrency=${CHARACTER_EXTRACTION_CONCURRENCY}`);
console.log(`  - Redis URL: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
console.log(`  - Log Level: ${process.env.LOG_LEVEL || 'info'}`);
console.log('='.repeat(80));
