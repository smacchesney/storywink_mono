/**
 * Ready email (READY_EMAIL_ENABLED) — sending + idempotency.
 *
 * book-finalize calls maybeSendReadyEmail in its terminal update. Exactly one
 * email per book: finalize jobs retry (and a book can re-finalize after
 * fix-ups), so the send sits behind an AppEvent guard — a 'ready_email_sent'
 * row for the book means we already mailed the parent, skip. The event row is
 * written only AFTER Resend accepts the send, so a failed send stays
 * retryable on the next finalize.
 *
 * Failure posture: NEVER throws. A book completing matters more than any
 * email about it. Templates live in email.helpers.ts (tested).
 */

import { Resend } from 'resend';
import type { Logger } from 'pino';
import { trackEvent } from '@storywink/shared';
import prisma from '../database/index.js';
import {
  buildReadyEmail,
  emailBaseUrl,
  readyEmailEnabled,
  type ReadyEmailStatus,
} from './email.helpers.js';

export { readyEmailEnabled } from './email.helpers.js';

export const READY_EMAIL_SENT_EVENT = 'ready_email_sent';

const DEFAULT_FROM = 'Storywink <hello@storywink.ai>';

export interface MaybeSendReadyEmailParams {
  bookId: string;
  userId: string;
  /** Terminal book status — only COMPLETED and PARTIAL email. */
  status: string;
  title: string;
  /** Book.language ("en" | "ja"). */
  language: string;
  logger: Logger;
}

/**
 * Sends the "book is ready" email once per book, if the flag is on. Safe to
 * call unconditionally from finalize — every early exit and failure only logs.
 */
export async function maybeSendReadyEmail(params: MaybeSendReadyEmailParams): Promise<void> {
  const { bookId, userId, status, title, language, logger } = params;

  try {
    if (status !== 'COMPLETED' && status !== 'PARTIAL') return;
    if (!readyEmailEnabled()) {
      logger.debug({ bookId, status }, 'Ready email disabled — skipping');
      return;
    }

    // Idempotency guard: one email per book, across finalize retries and
    // later re-finalizes (a PARTIAL book that gets fixed up must not mail
    // the parent a second time).
    const alreadySent = await prisma.appEvent.findFirst({
      where: { name: READY_EMAIL_SENT_EVENT, bookId },
      select: { id: true },
    });
    if (alreadySent) {
      logger.info({ bookId }, 'Ready email already sent for this book — skipping');
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) {
      logger.warn({ bookId, userId }, 'Ready email skipped: no email on User row');
      return;
    }

    const content = buildReadyEmail({
      status: status as ReadyEmailStatus,
      title,
      bookId,
      language,
      baseUrl: emailBaseUrl(),
    });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to: user.email,
      subject: content.subject,
      html: content.html,
    });

    if (error) {
      logger.warn(
        { bookId, status, error: error.message },
        'Ready email send failed — book completion unaffected',
      );
      return;
    }

    // Recorded only after a successful send; doubles as the idempotency key.
    await trackEvent(
      prisma,
      { name: READY_EMAIL_SENT_EVENT, userId, bookId, props: { status } },
      logger,
    );
    logger.info({ bookId, status, resendId: data?.id }, 'Ready email sent');
  } catch (error) {
    logger.warn(
      { bookId, error: error instanceof Error ? error.message : 'Unknown error' },
      'Ready email failed — book completion unaffected',
    );
  }
}
