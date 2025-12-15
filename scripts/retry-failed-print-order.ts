#!/usr/bin/env tsx
/**
 * Retry a failed print order by resetting its status and re-queuing the fulfillment job.
 *
 * Usage: npx tsx scripts/retry-failed-print-order.ts <orderId>
 * Example: npx tsx scripts/retry-failed-print-order.ts cmj7akirs0053le0d8ody1m0s
 *
 * Prerequisites:
 * - Ensure the Chromium fix has been deployed to workers
 * - Set REDIS_URL environment variable (or run from an environment where it's set)
 */

import prisma from '../packages/database/src/index.js';
import { Queue } from 'bullmq';
import { createBullMQConnection, QUEUE_NAMES } from '@storywink/shared';

const orderId = process.argv[2];

if (!orderId) {
  console.error('Usage: npx tsx scripts/retry-failed-print-order.ts <orderId>');
  console.error('');
  console.error('Example:');
  console.error('  npx tsx scripts/retry-failed-print-order.ts cmj7akirs0053le0d8ody1m0s');
  process.exit(1);
}

async function retryFailedOrder() {
  try {
    // Fetch the order
    const order = await prisma.printOrder.findUnique({
      where: { id: orderId },
      include: {
        book: { select: { title: true } },
        user: { select: { email: true } },
      },
    });

    if (!order) {
      console.error(`❌ Order not found: ${orderId}`);
      process.exit(1);
    }

    console.log(`Found order: ${orderId}`);
    console.log(`  Book: ${order.book?.title || 'Unknown'}`);
    console.log(`  User: ${order.user?.email || order.contactEmail || 'Unknown'}`);
    console.log(`  Status: ${order.status}`);
    console.log(`  Created: ${order.createdAt}`);

    if (order.status !== 'FAILED') {
      console.error(`\n❌ Order is not in FAILED status. Current status: ${order.status}`);
      console.error('Only FAILED orders can be retried with this script.');
      process.exit(1);
    }

    // Reset order status to PAYMENT_COMPLETED
    console.log('\nResetting order status to PAYMENT_COMPLETED...');
    await prisma.printOrder.update({
      where: { id: orderId },
      data: { status: 'PAYMENT_COMPLETED' },
    });
    console.log('✓ Order status reset');

    // Queue the print fulfillment job
    console.log('\nConnecting to Redis and queuing fulfillment job...');
    const queue = new Queue(QUEUE_NAMES.PRINT_FULFILLMENT, {
      connection: createBullMQConnection(),
    });

    await queue.add(
      'fulfill-order',
      {
        printOrderId: orderId,
        userId: order.userId,
        bookId: order.bookId,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 }, // 1 min, 2 min, 4 min
      }
    );

    console.log('✓ Fulfillment job queued');
    console.log(`\n✅ Order ${orderId} has been re-queued for fulfillment`);
    console.log('\nNext steps:');
    console.log('1. Monitor Railway worker logs for PDF generation');
    console.log('2. Check for "[PDF] Launching browser at /usr/bin/chromium-browser"');
    console.log('3. Verify Lulu print job is created');

    await queue.close();
  } catch (error) {
    console.error('\n❌ Error retrying order:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

retryFailedOrder();
