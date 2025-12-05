// ============================================================================
// CRITICAL: Force unbuffered I/O for Railway real-time logging
// Build trigger: 2024-11-30
// ============================================================================
// Node.js buffers stdout/stderr by default, causing logs from fast-failing
// jobs to be lost when the process terminates before the buffer flushes.
// This forces synchronous, unbuffered writes so Railway captures all logs.
// Must be set BEFORE any imports that might write to stdout/stderr.
// ============================================================================
if (process.stdout._handle?.setBlocking) {
  process.stdout._handle.setBlocking(true);
}
if (process.stderr._handle?.setBlocking) {
  process.stderr._handle.setBlocking(true);
}

// Disable Pino's internal buffering for immediate log writes
process.env.PINO_NO_BUFFER = 'true';

import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { config } from 'dotenv';
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
const requiredEnvVars = ['REDIS_URL', 'OPENAI_API_KEY', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
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

// Create Redis connection with BullMQ-specific options
// Uses family: 0 for IPv6 support on Railway private networking
const redis = new Redis(createBullMQConnection());

// Import worker processors
import { processStoryGeneration } from './workers/story-generation.worker.js';
import { processIllustrationGeneration } from './workers/illustration-generation.worker.js';
import { processBookFinalize } from './workers/book-finalize.worker.js';

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

console.log(`[Startup] Concurrency settings:`);
console.log(`  - Story: ${STORY_CONCURRENCY}`);
console.log(`  - Illustration: ${ILLUSTRATION_CONCURRENCY}`);
console.log(`  - Finalize: ${FINALIZE_CONCURRENCY}`);

// Create workers
const storyWorker = new Worker(
  QUEUE_NAMES.STORY_GENERATION,
  processStoryGeneration,
  {
    connection: redis,
    concurrency: STORY_CONCURRENCY,
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
  const failureStage = err.message.includes('OpenAI') ? 'ai_generation' :
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

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down workers...');
  
  await storyWorker.close();
  await illustrationWorker.close();
  await finalizeWorker.close();
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
console.log(`  - Redis URL: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
console.log(`  - Log Level: ${process.env.LOG_LEVEL || 'info'}`);
console.log('='.repeat(80));
