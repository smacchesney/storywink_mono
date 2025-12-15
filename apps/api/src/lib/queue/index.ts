import { Queue, WorkerOptions } from "bullmq";
import IORedis from "ioredis";
import { FlowProducer } from "bullmq";
import { createBullMQConnection } from "@storywink/shared/redis";

// Ensure Redis URL is provided via environment variables
if (!process.env.REDIS_URL) {
  throw new Error("Missing REDIS_URL environment variable");
}

// Reusable connection options
// Uses family: 0 for IPv6 support on Railway private networking
const connectionOptions = {
  connection: new IORedis(createBullMQConnection()),
};

// Create and export a single FlowProducer instance
export const flowProducer = new FlowProducer(connectionOptions);

// Define queue names centrally
export enum QueueName {
  StoryGeneration = "story-generation",
  IllustrationGeneration = "illustration-generation",
  BookFinalize = "book-finalize",
  PrintFulfillment = "print-fulfillment",
}

// Function to create or get a queue instance
const queues: Map<QueueName, Queue> = new Map();

export function getQueue(name: QueueName): Queue {
  if (!queues.has(name)) {
    const newQueue = new Queue(name, connectionOptions);
    queues.set(name, newQueue);
  }
  return queues.get(name)!;
}

// Export connection options for worker configuration
export const workerConnectionOptions: WorkerOptions = connectionOptions;

// Example Usage (in API route or server action):
// import { getQueue, QueueName } from './lib/queue';
// const storyQueue = getQueue(QueueName.StoryGeneration);
// await storyQueue.add('generate-story-job', { userId: '...', bookId: '...', inputs: { ... } });

// Example Worker setup (in a separate worker process file):
// import { Worker } from 'bullmq';
// import { QueueName, workerConnectionOptions } from './lib/queue';
// const worker = new Worker(QueueName.StoryGeneration, async job => {
//   console.log('Processing job:', job.id, job.data);
//   // Call AI generation logic here
// }, workerConnectionOptions);
