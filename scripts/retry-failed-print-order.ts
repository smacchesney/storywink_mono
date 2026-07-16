#!/usr/bin/env tsx
/**
 * Retry a failed print order by resetting its status and re-queuing the fulfillment job.
 *
 * Usage: npx tsx scripts/retry-failed-print-order.ts <orderId> [--confirm-not-submitted]
 * Example: npx tsx scripts/retry-failed-print-order.ts cmj7akirs0053le0d8ody1m0s
 *
 * --confirm-not-submitted: required when the order died inside the Lulu
 * submission window (luluSubmissionAttemptedAt set, no luluPrintJobId). It
 * asserts you checked Lulu's dashboard for external_id=<orderId> and found no
 * print job; the script then clears the claim so the worker may submit again.
 *
 * Prerequisites:
 * - Ensure the Chromium fix has been deployed to workers
 * - Set REDIS_URL environment variable (or run from an environment where it's set)
 */

import prisma from '../packages/database/src/index.js';
import { Queue } from 'bullmq';
import { createBullMQConnection, QUEUE_NAMES } from '@storywink/shared';

const args = process.argv.slice(2);
const confirmNotSubmitted = args.includes('--confirm-not-submitted');
const orderId = args.find((arg) => !arg.startsWith('--'));

if (!orderId) {
  console.error(
    'Usage: npx tsx scripts/retry-failed-print-order.ts <orderId> [--confirm-not-submitted]',
  );
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

    if (order.luluPrintJobId) {
      console.error(`\n❌ Order already has Lulu print job ${order.luluPrintJobId}.`);
      console.error('Retrying would submit a second paid order. Nothing to do here —');
      console.error('if the order status is wrong, fix it directly against the Lulu job.');
      process.exit(1);
    }

    // A claim without a Lulu id means a previous run died inside the
    // submission window — Lulu may or may not have the job. A wedged claim can
    // leave the order in PAYMENT_COMPLETED (stalled worker) or FAILED.
    const wedgedSubmission = Boolean(order.luluSubmissionAttemptedAt);

    // PAYMENT_COMPLETED without a claim covers a worker that died before ever
    // reaching Lulu (e.g. a stall during PDF generation). Re-enqueueing is
    // safe even if a job is still queued: the worker's atomic claim lets only
    // one run submit.
    const retryable = order.status === 'FAILED' || order.status === 'PAYMENT_COMPLETED';
    if (!retryable) {
      console.error(`\n❌ Order is not retryable. Current status: ${order.status}`);
      console.error('Only FAILED or stuck PAYMENT_COMPLETED orders can be retried.');
      process.exit(1);
    }

    if (wedgedSubmission && !confirmNotSubmitted) {
      console.error(`\n❌ This order died inside the Lulu submission window`);
      console.error(
        `   (luluSubmissionAttemptedAt=${order.luluSubmissionAttemptedAt?.toISOString()}, no luluPrintJobId).`,
      );
      console.error('   Lulu may already have this print job. Before retrying:');
      console.error(`   1. Search Lulu's dashboard/API for external_id=${orderId}`);
      console.error(
        '   2. If a print job EXISTS: set luluPrintJobId + status=SUBMITTED_TO_LULU manually.',
      );
      console.error(
        '   3. If NO print job exists: re-run this script with --confirm-not-submitted.',
      );
      process.exit(1);
    }

    // Reset order status to PAYMENT_COMPLETED (and release the submission
    // claim when the operator confirmed Lulu has no job for this order)
    console.log('\nResetting order status to PAYMENT_COMPLETED...');
    await prisma.printOrder.update({
      where: { id: orderId },
      data: {
        status: 'PAYMENT_COMPLETED',
        ...(wedgedSubmission ? { luluSubmissionAttemptedAt: null } : {}),
      },
    });
    console.log(`✓ Order status reset${wedgedSubmission ? ' (submission claim cleared)' : ''}`);

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
      },
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
