import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { config } from 'dotenv';
import { QUEUE_NAMES } from './shared/index.ts';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
import { processStoryGeneration } from './workers/story-generation.worker.ts';
import { processIllustrationGeneration } from './workers/illustration-generation.worker.ts';
import { processBookFinalize } from './workers/book-finalize.worker.ts';

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
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
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
  logger.error({ 
    jobId: job?.id, 
    error: err.message,
    pageId: job?.data?.pageId,
    pageNumber: job?.data?.pageNumber,
    bookId: job?.data?.bookId,
    parentJobId: job?.parent?.id,
    attempts: job?.attemptsMade
  }, 'Illustration generation failed');
  console.error(`[IllustrationWorker] FAILED job ${job?.id}:`)
  console.error(`  - Book: ${job?.data?.bookId}`)
  console.error(`  - Page: ${job?.data?.pageNumber}`)
  console.error(`  - Parent Job: ${job?.parent?.id || 'None'}`)
  console.error(`  - Error: ${err.message}`)
  console.error(`  - Attempts: ${job?.attemptsMade}`)
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