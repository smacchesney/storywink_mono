import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { config } from 'dotenv';
import { QUEUE_NAMES } from '@storywink/shared';
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
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
});

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
    if (!value.referenceImageUrl) {
      console.error(`[Startup] FATAL: Style "${key}" missing referenceImageUrl`);
      process.exit(1);
    }
    console.log(`[Startup] ✓ Style "${key}" loaded with referenceImageUrl: ${value.referenceImageUrl}`);
  }

  console.log(`[Startup] ✓ STYLE_LIBRARY validated successfully (${Object.keys(STYLE_LIBRARY).length} styles)`);
}

// Run validation immediately at module load
validateStyleLibrary();
console.log('[Startup] styles module URL:', import.meta.url);
console.log('[Startup] referenceImageUrl snapshot:', STYLE_LIBRARY.vignette?.referenceImageUrl);

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

// Generate SHA256 hash of the STYLE_LIBRARY for verification
// This lets us confirm all containers are running the same code
const styleLibraryHash = crypto
  .createHash('sha256')
  .update(JSON.stringify(STYLE_LIBRARY))
  .digest('hex');

console.log('='.repeat(80));
console.log('[DIAGNOSTIC] STYLE_LIBRARY Protection Applied');
console.log('='.repeat(80));
console.log(`[Startup] STYLE_LIBRARY frozen and verified`);
console.log(`[Startup] SHA256 Hash: ${styleLibraryHash}`);
console.log(`[Startup] Process PID: ${process.pid}`);
console.log(`[Startup] Hostname: ${process.env.HOSTNAME || 'unknown'}`);
console.log(`[Startup] Railway Commit: ${process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown'}`);
console.log(`[Startup] Git Commit: ${process.env.GIT_COMMIT_SHA || 'unknown'}`);
console.log('='.repeat(80));

// Create workers
const storyWorker = new Worker(
  QUEUE_NAMES.STORY_GENERATION,
  processStoryGeneration,
  {
    connection: redis,
    concurrency: 2,
  }
);

const illustrationWorker = new Worker(
  QUEUE_NAMES.ILLUSTRATION_GENERATION,
  processIllustrationGeneration,
  {
    connection: redis,
    concurrency: 3,
  }
);

const finalizeWorker = new Worker(
  QUEUE_NAMES.BOOK_FINALIZE,
  processBookFinalize,
  {
    connection: redis,
    concurrency: 2,
  }
);

// Worker event handlers
storyWorker.on('active', (job) => {
  console.log(`[StoryWorker] Job ${job.id} started for book ${job.data.bookId}`);
});

storyWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, bookId: job.data.bookId }, 'Story generation completed');
  console.log(`[StoryWorker] Completed job ${job.id} for book ${job.data.bookId}`);
});

storyWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Story generation failed');
  console.error(`[StoryWorker] Failed job ${job?.id}: ${err.message}`);
});

illustrationWorker.on('active', (job) => {
  console.log(`[IllustrationWorker] Job ${job.id} started:`)
  console.log(`  - Book: ${job.data.bookId}`)
  console.log(`  - Page: ${job.data.pageNumber}`)
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
                      err.message.includes('database') ? 'database_update' : 'unknown';
                      
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
  
  console.error(`[IllustrationWorker] FAILED job ${job?.id}:`)
  console.error(`  - Book: ${job?.data?.bookId}`)
  console.error(`  - Page: ${job?.data?.pageNumber}`)
  console.error(`  - Parent Job: ${job?.parent?.id || 'None'}`)
  console.error(`  - Error: ${err.message}`)
  console.error(`  - Failure Stage: ${failureStage}`)
  console.error(`  - Attempts: ${job?.attemptsMade}/${job?.opts?.attempts || 'unknown'}`)
  console.error(`  - Will Retry: ${(job?.attemptsMade || 0) < (job?.opts?.attempts || 1)}`)
});

finalizeWorker.on('active', (job) => {
  console.log(`[FinalizeWorker] Started finalization job ${job.id} for book ${job.data.bookId}`);
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
  console.error(`[FinalizeWorker] FAILED finalization job ${job?.id}:`)
  console.error(`  - Book: ${job?.data?.bookId}`)
  console.error(`  - Error: ${err.message}`)
  console.error(`  - Attempts: ${job?.attemptsMade}`)
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

logger.info('Workers started successfully');
console.log('[Workers] All workers started and listening for jobs');
console.log('[Workers] Configuration:');
console.log(`  - Story Worker: concurrency=${2}`);
console.log(`  - Illustration Worker: concurrency=${3}`);
console.log(`  - Finalize Worker: concurrency=${2}, retries=${3}`);
console.log(`  - Redis URL: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
console.log(`  - Log Level: ${process.env.LOG_LEVEL || 'info'}`);