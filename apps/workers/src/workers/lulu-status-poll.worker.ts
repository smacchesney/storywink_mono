import { Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import pino from 'pino';
import prisma from '../database/index.js';
import { trackEvent } from '@storywink/shared';
import { getLuluClient } from '../utils/lulu-client.js';
import {
  LULU_POLL_BATCH_SIZE,
  OPEN_ORDER_STATUSES,
  decideOrderTransition,
  extractTrackingUrl,
  pollCutoffDate,
} from './lulu-status-poll.helpers.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Repeatable sweep that asks Lulu where every open print order is and moves
 * the PrintOrder row forward: SUBMITTED_TO_LULU → IN_PRODUCTION → SHIPPED
 * (+ tracking URL), or sideways to FAILED/CANCELLED with a Sentry alert —
 * a paid order going wrong is founder-page material. Parents get a
 * Notification on SHIPPED and on FAILED/CANCELLED; IN_PRODUCTION is silent
 * (the /orders page shows it without a ping). Defensive by design: one bad
 * order never stops the batch, and the handler never throws.
 */
export async function processLuluStatusPoll(job: Job) {
  const summary = { scanned: 0, advanced: 0, shipped: 0, sideways: 0, skipped: 0, errors: 0 };

  try {
    const orders = await prisma.printOrder.findMany({
      where: {
        status: { in: [...OPEN_ORDER_STATUSES] },
        luluPrintJobId: { not: null },
        createdAt: { gte: pollCutoffDate(new Date()) },
      },
      orderBy: { updatedAt: 'asc' },
      take: LULU_POLL_BATCH_SIZE,
      include: { book: { select: { title: true } } },
    });
    summary.scanned = orders.length;

    if (orders.length === 0) {
      return summary;
    }

    // Created lazily so a worker without Lulu credentials only fails when
    // there is actually an order to poll (and the error lands in the log).
    const luluClient = getLuluClient();

    for (const order of orders) {
      try {
        const luluJob = await luluClient.getPrintJob(order.luluPrintJobId!);
        const luluStatus = luluJob.status?.name;
        const transition = decideOrderTransition(order.status, luluStatus);

        if (transition.kind === 'unknown') {
          // New or undocumented Lulu status: log it, never guess a transition.
          logger.warn(
            { printOrderId: order.id, luluPrintJobId: order.luluPrintJobId, luluStatus },
            'Lulu poll: unknown Lulu status — skipping order',
          );
          summary.skipped += 1;
          continue;
        }

        if (transition.kind === 'noop') {
          summary.skipped += 1;
          continue;
        }

        const { nextStatus } = transition;
        const trackingUrl =
          nextStatus === 'SHIPPED' ? extractTrackingUrl(luluJob.line_items) : null;

        // Conditional transition = idempotency guard against a concurrent
        // sweep or webhook moving the order between the query and now.
        const updated = await prisma.printOrder.updateMany({
          where: { id: order.id, status: order.status },
          data: {
            status: nextStatus,
            ...(nextStatus === 'SHIPPED'
              ? { shippedAt: new Date(), ...(trackingUrl ? { trackingUrl } : {}) }
              : {}),
          },
        });
        if (updated.count === 0) {
          summary.skipped += 1;
          continue;
        }
        summary.advanced += 1;

        const bookTitle = order.book?.title?.trim() || 'your book';

        if (nextStatus === 'SHIPPED') {
          summary.shipped += 1;
          await prisma.notification.create({
            data: {
              userId: order.userId,
              bookId: order.bookId,
              type: 'ORDER_SHIPPED',
              title: `"${bookTitle}" is on its way!`,
              message: `Your printed copy of "${bookTitle}" has shipped. Follow its journey on your orders page.`,
            },
          });
        } else if (nextStatus === 'FAILED' || nextStatus === 'CANCELLED') {
          summary.sideways += 1;
          // The support address lives in the message itself so the parent has
          // a way forward even before they reach the /orders page.
          await prisma.notification.create({
            data: {
              userId: order.userId,
              bookId: order.bookId,
              type: nextStatus === 'FAILED' ? 'ORDER_FAILED' : 'ORDER_CANCELLED',
              title: `Your order for "${bookTitle}" needs a hand`,
              message: `Printing "${bookTitle}" hit a snag. Write to us at support@storywink.ai and we'll make it right.`,
            },
          });
          // A paid order going sideways — the founder must know immediately.
          Sentry.captureException(
            new Error(`Lulu reported ${luluStatus} for print order ${order.id}`),
            {
              tags: { worker: 'lulu-status-poll' },
              extra: {
                printOrderId: order.id,
                luluPrintJobId: order.luluPrintJobId,
                luluStatus,
                bookId: order.bookId,
                userId: order.userId,
              },
            },
          );
        }

        await trackEvent(
          prisma,
          {
            name: 'order_status_changed',
            userId: order.userId,
            bookId: order.bookId,
            props: { status: nextStatus, printOrderId: order.id, luluStatus },
          },
          logger,
        );

        logger.info(
          {
            printOrderId: order.id,
            from: order.status,
            to: nextStatus,
            luluStatus,
            trackingUrl,
          },
          'Lulu poll: order status advanced',
        );
      } catch (error) {
        // One broken order (or one Lulu 5xx) must not stop the sweep.
        summary.errors += 1;
        logger.error(
          {
            printOrderId: order.id,
            luluPrintJobId: order.luluPrintJobId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Lulu poll: failed to poll order',
        );
      }
    }

    logger.info({ jobId: job.id, ...summary }, 'Lulu status poll finished');
  } catch (error) {
    // Sweep-level failure (DB down, missing Lulu credentials): log and let
    // the next scheduled sweep retry.
    logger.error(
      { jobId: job.id, error: error instanceof Error ? error.message : String(error) },
      'Lulu status poll sweep failed',
    );
  }

  return summary;
}
