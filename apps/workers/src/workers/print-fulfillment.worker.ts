/**
 * Print Fulfillment Worker
 *
 * Processes print orders after Stripe payment is confirmed:
 * 1. Generates interior and cover PDFs
 * 2. Uploads PDFs to Dropbox
 * 3. Submits print job to Lulu API
 *
 * This worker is triggered by the Stripe webhook after checkout.session.completed.
 */

import { Job } from 'bullmq';
import prisma from '../database/client.js';
import { PrintFulfillmentJob, getLuluLevelByTierKey } from '@storywink/shared';
import { generateBookPdf } from '../utils/pdf/generateBookPdf.js';
import { generateLuluCover } from '../utils/pdf/generateLuluCover.js';
import { uploadPdfToDropbox } from '../utils/dropbox.js';
import { getLuluClient } from '../utils/lulu-client.js';

/**
 * Process a print fulfillment job.
 *
 * Flow:
 * 1. Load PrintOrder and Book from database
 * 2. Update status to PROCESSING (via direct status update)
 * 3. Generate interior PDF
 * 4. Generate cover PDF
 * 5. Upload both to Dropbox
 * 6. Update PrintOrder with PDF URLs
 * 7. Create Lulu print job
 * 8. Update PrintOrder with Lulu job ID and final status
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
    // 1. Load PrintOrder from database
    const printOrder = await prisma.printOrder.findUnique({
      where: { id: printOrderId },
    });

    if (!printOrder) {
      throw new Error(`PrintOrder not found: ${printOrderId}`);
    }

    // Verify the order is ready for processing
    if (printOrder.status !== 'PAYMENT_COMPLETED') {
      console.log(`[PrintFulfillment] Order ${printOrderId} status is ${printOrder.status}, expected PAYMENT_COMPLETED`);
      // If already submitted, skip
      if (printOrder.status === 'SUBMITTED_TO_LULU' || printOrder.status === 'IN_PRODUCTION') {
        console.log(`[PrintFulfillment] Order already processed, skipping`);
        return;
      }
    }

    // 2. Load Book with pages
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        pages: {
          orderBy: { pageNumber: 'asc' },
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

    // 3. Generate interior PDF
    console.log(`[PrintFulfillment] Generating interior PDF...`);
    const interiorPdfBuffer = await generateBookPdf(book);
    console.log(`[PrintFulfillment] Interior PDF generated: ${interiorPdfBuffer.length} bytes`);

    await job.updateProgress({ stage: 'interior_pdf_complete', percent: 30 });

    // 4. Generate cover PDF
    console.log(`[PrintFulfillment] Generating cover PDF...`);
    const coverPdfBuffer = await generateLuluCover(book);
    console.log(`[PrintFulfillment] Cover PDF generated: ${coverPdfBuffer.length} bytes`);

    await job.updateProgress({ stage: 'cover_pdf_complete', percent: 50 });

    // 5. Upload PDFs to Dropbox
    console.log(`[PrintFulfillment] Uploading PDFs to Dropbox...`);

    const [interiorResult, coverResult] = await Promise.all([
      uploadPdfToDropbox(interiorPdfBuffer, bookId, 'interior.pdf'),
      uploadPdfToDropbox(coverPdfBuffer, bookId, 'cover.pdf'),
    ]);

    console.log(`[PrintFulfillment] Interior PDF URL: ${interiorResult.url}`);
    console.log(`[PrintFulfillment] Cover PDF URL: ${coverResult.url}`);

    await job.updateProgress({ stage: 'pdfs_uploaded', percent: 70 });

    // 6. Update PrintOrder with PDF URLs
    await prisma.printOrder.update({
      where: { id: printOrderId },
      data: {
        interiorPdfUrl: interiorResult.url,
        coverPdfUrl: coverResult.url,
      },
    });

    // 7. Create Lulu print job
    console.log(`[PrintFulfillment] Submitting to Lulu...`);

    const luluClient = getLuluClient();
    const luluJob = await luluClient.createPrintJob({
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

    console.log(`[PrintFulfillment] Lulu job created: ${luluJob.id}`);
    console.log(`[PrintFulfillment] Lulu status: ${luluJob.status.name}`);

    await job.updateProgress({ stage: 'lulu_submitted', percent: 90 });

    // 8. Update PrintOrder with Lulu job ID and status
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
    console.error('='.repeat(80));
    console.error(`[PrintFulfillment] FAILED - Order ${printOrderId}`);
    console.error(`  Error: ${err.message}`);
    console.error(`  Stack: ${err.stack}`);
    console.error('='.repeat(80));

    // Update order status to FAILED
    try {
      await prisma.printOrder.update({
        where: { id: printOrderId },
        data: { status: 'FAILED' },
      });
    } catch (updateError) {
      console.error(`[PrintFulfillment] Failed to update order status to FAILED:`, updateError);
    }

    // Re-throw to trigger BullMQ retry logic
    throw error;
  }
}
