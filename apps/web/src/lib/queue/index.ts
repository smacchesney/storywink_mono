import { Queue, WorkerOptions } from 'bullmq';
import IORedis from 'ioredis';
import { FlowProducer } from 'bullmq';
import { createBullMQConnection } from '@storywink/shared/redis';

// Lazy initialization variables
let connectionOptions: { connection: IORedis } | null = null;
let flowProducerInstance: FlowProducer | null = null;

// Function to get or create connection options
// Uses family: 0 for IPv6 support on Railway private networking
function getConnectionOptions(): { connection: IORedis } {
  if (!connectionOptions) {
    connectionOptions = {
      connection: new IORedis(createBullMQConnection()),
    };
  }
  return connectionOptions;
}

// Lazy getter for FlowProducer instance
export function getFlowProducer(): FlowProducer {
  if (!flowProducerInstance) {
    flowProducerInstance = new FlowProducer(getConnectionOptions());
  }
  return flowProducerInstance;
}

// Export flowProducer as a getter for backward compatibility
// Use a Proxy to forward all method calls to the lazy-initialized instance
export const flowProducer = new Proxy({} as FlowProducer, {
  get: (_target, prop) => {
    const instance = getFlowProducer();
    return (instance as any)[prop];
  }
});

// Define queue names centrally
export enum QueueName {
  StoryGeneration = 'story-generation',
  IllustrationGeneration = 'illustration-generation',
  BookFinalize = 'book-finalize', // Add queue for finalization job
  // Add other queue names here if needed
}

// Function to create or get a queue instance
const queues: Map<QueueName, Queue> = new Map();

export function getQueue(name: QueueName): Queue {
  if (!queues.has(name)) {
    const newQueue = new Queue(name, getConnectionOptions());
    queues.set(name, newQueue);
  }
  return queues.get(name)!;
}

// Export connection options for worker configuration as a getter
export function getWorkerConnectionOptions(): WorkerOptions {
  return getConnectionOptions();
}

// For backward compatibility, export as property with getter
Object.defineProperty(exports, 'workerConnectionOptions', {
  get: function() {
    return getConnectionOptions();
  }
});

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