/**
 * Print Fulfillment Worker
 *
 * Processes print orders after Stripe payment is confirmed:
 * 1. Generates interior and cover PDFs
 * 2. Uploads PDFs to Dropbox
 * 3. Submits print job to Lulu API
 *
 * This worker is triggered by the Stripe webhook after checkout.session.completed.
 *
 * Idempotency: Lulu submission is a paid, non-idempotent call, so it is fenced
 * by luluSubmissionAttemptedAt — claimed atomically right before the call. A
 * claim without a recorded luluPrintJobId means a previous run died where the
 * outcome is unknowable; those orders fail closed (UnrecoverableError, no
 * retry) and need manual reconciliation against Lulu (external_id = order id).
 */

import { Job, UnrecoverableError } from 'bullmq';
import * as Sentry from '@sentry/node';
import prisma from '../database/client.js';
import { PrintFulfillmentJob, getLuluLevelByTierKey } from '@storywink/shared';
import { collagePagesForPrint } from '@storywink/shared/collage';
import { generateBookPdf, generateLuluCover } from '@storywink/pdf';
import { loadWorkerPdfFonts } from '../utils/pdf-fonts.js';
import { uploadPdfToDropbox } from '../utils/dropbox.js';
import { getLuluClient, LuluApiError, type LuluPrintJob } from '../utils/lulu-client.js';
import {
  decideFulfillmentAction,
  classifyLuluSubmissionError,
} from './print-fulfillment.helpers.js';

function ambiguousSubmissionMessage(printOrderId: string, cause?: string): string {
  return (
    `Order ${printOrderId}: a Lulu submission was started but no print job id was recorded` +
    (cause ? ` (${cause})` : '') +
    `. NOT resubmitting — a duplicate would be a second paid order. ` +
    `Reconcile manually: search Lulu print jobs for external_id=${printOrderId}; ` +
    `if one exists set luluPrintJobId/status on the PrintOrder, otherwise run ` +
    `scripts/retry-failed-print-order.ts ${printOrderId} --confirm-not-submitted.`
  );
}

/**
 * Process a print fulfillment job.
 *
 * Flow:
 * 1. Load PrintOrder and decide whether this run may act at all
 * 2. Load Book with pages
 * 3. Generate interior + cover PDFs
 * 4. Upload both to Dropbox, store URLs on the PrintOrder
 * 5. Atomically claim the Lulu submission window
 * 6. Create Lulu print job
 * 7. Update PrintOrder with Lulu job ID and final status
 */
export async function processPrintFulfillment(job: Job<PrintFulfillmentJob>): Promise<void> {
  const { printOrderId, bookId, userId } = job.data;

  console.log('='.repeat(80));
  console.log(`[PrintFulfillment] Starting job ${job.id}`);
  console.log(`  Order: ${printOrderId}`);
  console.log(`  Book: ${bookId}`);
  console.log(`  User: ${userId}`);
  console.log('='.repeat(80));

  try {
    // 1. Load PrintOrder and decide whether any work is allowed
    const printOrder = await prisma.printOrder.findUnique({
      where: { id: printOrderId },
    });

    if (!printOrder) {
      throw new Error(`PrintOrder not found: ${printOrderId}`);
    }

    const decision = decideFulfillmentAction(printOrder);
    if (decision.kind === 'skip') {
      console.log(`[PrintFulfillment] Order ${printOrderId} skipped: ${decision.reason}`);
      return;
    }
    if (decision.kind === 'ambiguous-submission') {
      throw new UnrecoverableError(ambiguousSubmissionMessage(printOrderId));
    }

    // 2. Load Book with pages
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        pages: {
          orderBy: { pageNumber: 'asc' },
          include: { asset: { select: { url: true } } },
        },
      },
    });

    if (!book) {
      throw new Error(`Book not found: ${bookId}`);
    }

    // Verify book is completed
    if (book.status !== 'COMPLETED' && book.status !== 'PARTIAL') {
      throw new Error(`Book ${bookId} is not ready for printing (status: ${book.status})`);
    }

    console.log(`[PrintFulfillment] Book loaded: "${book.title}" with ${book.pages.length} pages`);

    // Report progress: Starting PDF generation
    await job.updateProgress({ stage: 'generating_pdfs', percent: 10 });

    // Fonts are loaded once and injected into the runtime-agnostic PDF package.
    const pdfFonts = loadWorkerPdfFonts();

    // 3. Generate interior PDF (all pages including cover photo).
    // Lulu path uses generator defaults: no title page, no back cover, padded to 4.
    console.log(`[PrintFulfillment] Generating interior PDF (${book.pages.length} pages)...`);
    // Same collage rule as checkout + the interior route: flag on AND under
    // the 48-page saddle-stitch cap, so the shipped PDF matches the priced count.
    const includeCollage =
      process.env.COLLAGE_PAGES_ENABLED === 'true' && collagePagesForPrint(book.pages.length) > 0;
    const interiorPdfBuffer = await generateBookPdf(book, {
      fonts: pdfFonts,
      includeCollage,
    });
    console.log(`[PrintFulfillment] Interior PDF generated: ${interiorPdfBuffer.length} bytes`);

    await job.updateProgress({ stage: 'interior_pdf_complete', percent: 30 });

    // Generate cover PDF
    console.log(`[PrintFulfillment] Generating cover PDF...`);
    const coverPdfBuffer = await generateLuluCover(book, { fonts: pdfFonts });
    console.log(`[PrintFulfillment] Cover PDF generated: ${coverPdfBuffer.length} bytes`);

    await job.updateProgress({ stage: 'cover_pdf_complete', percent: 50 });

    // 4. Upload PDFs to Dropbox
    console.log(`[PrintFulfillment] Uploading PDFs to Dropbox...`);

    const [interiorResult, coverResult] = await Promise.all([
      uploadPdfToDropbox(interiorPdfBuffer, bookId, 'interior.pdf'),
      uploadPdfToDropbox(coverPdfBuffer, bookId, 'cover.pdf'),
    ]);

    console.log(`[PrintFulfillment] Interior PDF URL: ${interiorResult.url}`);
    console.log(`[PrintFulfillment] Cover PDF URL: ${coverResult.url}`);

    await job.updateProgress({ stage: 'pdfs_uploaded', percent: 70 });

    // Update PrintOrder with PDF URLs
    await prisma.printOrder.update({
      where: { id: printOrderId },
      data: {
        interiorPdfUrl: interiorResult.url,
        coverPdfUrl: coverResult.url,
      },
    });

    // 5. Atomically claim the Lulu submission window. The test-and-set on
    // luluSubmissionAttemptedAt is what makes double submission impossible:
    // whichever run loses the race sees count 0 and never calls Lulu.
    const claim = await prisma.printOrder.updateMany({
      where: { id: printOrderId, luluSubmissionAttemptedAt: null },
      data: { luluSubmissionAttemptedAt: new Date() },
    });

    if (claim.count === 0) {
      const fresh = await prisma.printOrder.findUnique({
        where: { id: printOrderId },
        select: { luluPrintJobId: true },
      });
      if (fresh?.luluPrintJobId) {
        console.log(
          `[PrintFulfillment] Order ${printOrderId} already submitted (Lulu job ${fresh.luluPrintJobId}), skipping`,
        );
        return;
      }
      throw new UnrecoverableError(ambiguousSubmissionMessage(printOrderId));
    }

    // 6. Create Lulu print job
    console.log(`[PrintFulfillment] Submitting to Lulu...`);

    const luluClient = getLuluClient();
    let luluJob: LuluPrintJob;
    try {
      luluJob = await luluClient.createPrintJob({
        contactEmail: printOrder.contactEmail || '',
        quantity: printOrder.quantity,
        interiorPdfUrl: interiorResult.url,
        coverPdfUrl: coverResult.url,
        shippingAddress: {
          name: printOrder.shippingName || '',
          street1: printOrder.shippingStreet1 || '',
          street2: printOrder.shippingStreet2 || undefined,
          city: printOrder.shippingCity || '',
          state_code: printOrder.shippingState || undefined,
          country_code: printOrder.shippingCountry || 'US',
          postcode: printOrder.shippingPostcode || '',
          phone_number: printOrder.shippingPhone || undefined,
        },
        shippingLevel: getLuluLevelByTierKey(printOrder.shippingTier || 'sg_my'),
        bookTitle: book.title,
        externalId: printOrderId,
      });
    } catch (submitError: unknown) {
      const httpStatus = submitError instanceof LuluApiError ? submitError.httpStatus : undefined;
      if (classifyLuluSubmissionError(httpStatus) === 'not-created') {
        // Lulu received and rejected the request — no print job exists.
        // Release the claim so a BullMQ retry can submit cleanly.
        await prisma.printOrder.updateMany({
          where: { id: printOrderId },
          data: { luluSubmissionAttemptedAt: null },
        });
        throw submitError;
      }
      // 5xx or network failure: Lulu may or may not have created the job.
      // Keep the claim and stop retrying — fail closed.
      throw new UnrecoverableError(
        ambiguousSubmissionMessage(printOrderId, (submitError as Error).message),
      );
    }

    console.log(`[PrintFulfillment] Lulu job created: ${luluJob.id}`);
    console.log(`[PrintFulfillment] Lulu status: ${luluJob.status.name}`);

    await job.updateProgress({ stage: 'lulu_submitted', percent: 90 });

    // 7. Update PrintOrder with Lulu job ID and status
    await prisma.printOrder.update({
      where: { id: printOrderId },
      data: {
        luluPrintJobId: luluJob.id.toString(),
        status: 'SUBMITTED_TO_LULU',
        submittedAt: new Date(),
      },
    });

    console.log('='.repeat(80));
    console.log(`[PrintFulfillment] SUCCESS - Order ${printOrderId}`);
    console.log(`  Lulu Job ID: ${luluJob.id}`);
    console.log(`  Status: SUBMITTED_TO_LULU`);
    console.log('='.repeat(80));

    await job.updateProgress({ stage: 'completed', percent: 100 });
  } catch (error: unknown) {
    const err = error as Error;
    Sentry.captureException(err, {
      tags: { worker: 'print-fulfillment', jobId: job.id },
      extra: { printOrderId, bookId, userId },
    });
    console.error('='.repeat(80));
    console.error(`[PrintFulfillment] FAILED - Order ${printOrderId}`);
    console.error(`  Error: ${err.message}`);
    console.error(`  Stack: ${err.stack}`);
    console.error('='.repeat(80));

    // Mark the order FAILED — but never downgrade one that already has a Lulu
    // job recorded (a post-submission hiccup is not a fulfillment failure).
    try {
      await prisma.printOrder.updateMany({
        where: { id: printOrderId, luluPrintJobId: null },
        data: { status: 'FAILED' },
      });
    } catch (updateError) {
      console.error(`[PrintFulfillment] Failed to update order status to FAILED:`, updateError);
    }

    // Re-throw to trigger BullMQ retry logic (UnrecoverableError skips retries)
    throw error;
  }
}
