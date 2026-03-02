import { Job, FlowProducer } from 'bullmq';
import prisma from '../database/index.js';
import { BookFinalizeJob, CharacterIdentity, BookQCResult } from '@storywink/shared/types';
import { QUEUE_NAMES } from '@storywink/shared/constants';
import { categorizePages, isTitlePage } from '@storywink/shared/utils';
import { createBullMQConnection } from '@storywink/shared/redis';
import OpenAI from 'openai';
import { optimizeCloudinaryUrlForVision } from '@storywink/shared/utils';
import { createQCPrompt, QC_SYSTEM_PROMPT, QC_RESPONSE_SCHEMA } from '@storywink/shared/prompts/quality-check';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const MAX_QC_ROUNDS = 2;

/**
 * Run quality check on all generated illustrations using OpenAI vision.
 * Returns null if QC cannot be run (no API key, no images, etc.)
 */
async function runQualityCheck(
  bookId: string,
  pages: Array<{ pageNumber: number; pageId: string; generatedImageUrl: string | null }>,
  characterIdentity: CharacterIdentity | null,
): Promise<BookQCResult | null> {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn({ bookId }, 'Skipping QC: OPENAI_API_KEY not configured');
    return null;
  }

  const illustratedPages = pages.filter(p => p.generatedImageUrl);
  if (illustratedPages.length < 2) {
    logger.info({ bookId, pageCount: illustratedPages.length }, 'Skipping QC: fewer than 2 illustrated pages');
    return null;
  }

  logger.info({ bookId, pageCount: illustratedPages.length }, 'Running quality check on illustrations');
  console.log(`[BookFinalize/QC] Running QC on ${illustratedPages.length} illustrations for book ${bookId}`);

  // Build image content parts from URLs directly (no base64 fetching)
  const contentParts: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string; detail: 'high' }
  > = [];
  const pageMapping: Array<{ pageNumber: number; pageId: string }> = [];

  for (const page of illustratedPages) {
    const url = optimizeCloudinaryUrlForVision(page.generatedImageUrl!);
    contentParts.push({ type: 'input_image', image_url: url, detail: 'high' });
    pageMapping.push({ pageNumber: page.pageNumber, pageId: page.pageId });
  }

  if (contentParts.length < 2) {
    logger.warn({ bookId }, 'Skipping QC: not enough images');
    return null;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const promptText = createQCPrompt(characterIdentity, contentParts.length);

  // Add the text prompt after all images
  contentParts.push({ type: 'input_text', text: promptText });

  const result = await openai.responses.create({
    model: 'gpt-5-mini',
    instructions: QC_SYSTEM_PROMPT,
    input: [{ role: 'user', content: contentParts }],
    text: {
      format: {
        type: 'json_schema',
        name: 'qc_response',
        strict: true,
        schema: QC_RESPONSE_SCHEMA as Record<string, unknown>,
      },
    },
  });

  const rawResult = result.output_text;
  if (!rawResult) {
    logger.error({ bookId }, 'OpenAI QC returned empty response');
    return null;
  }

  const qcResult = JSON.parse(rawResult) as {
    passed: boolean;
    summary: string;
    pageResults: Array<{
      pageNumber: number;
      passed: boolean;
      characterConsistencyScore: number;
      styleConsistencyScore: number;
      overallScore: number;
      issues: string[];
      suggestedPromptAdditions: string | null;
    }>;
  };

  // Map QC pageNumbers back to actual pageIds
  const mappedResults = qcResult.pageResults.map((pr, idx) => {
    const mapping = pageMapping[idx];
    return {
      pageNumber: mapping?.pageNumber ?? pr.pageNumber,
      pageId: mapping?.pageId ?? '',
      passed: pr.passed,
      issues: pr.issues,
      characterConsistencyScore: pr.characterConsistencyScore,
      styleConsistencyScore: pr.styleConsistencyScore,
      overallScore: pr.overallScore,
      suggestedPromptAdditions: pr.suggestedPromptAdditions ?? null,
    };
  });

  const failedPageIds = mappedResults
    .filter(r => !r.passed)
    .map(r => r.pageId);

  const bookQCResult: BookQCResult = {
    passed: qcResult.passed && failedPageIds.length === 0,
    qcRound: 0, // Will be set by caller
    pageResults: mappedResults,
    failedPageIds,
    summary: qcResult.summary,
  };

  logger.info({
    bookId,
    passed: bookQCResult.passed,
    failedCount: failedPageIds.length,
    totalChecked: mappedResults.length,
    summary: bookQCResult.summary,
  }, 'QC check completed');

  console.log(`[BookFinalize/QC] QC result for book ${bookId}:`);
  console.log(`  - Passed: ${bookQCResult.passed}`);
  console.log(`  - Failed pages: ${failedPageIds.length}/${mappedResults.length}`);
  console.log(`  - Summary: ${bookQCResult.summary}`);

  for (const pr of mappedResults) {
    if (!pr.passed) {
      console.log(`  - Page ${pr.pageNumber} FAILED (char: ${pr.characterConsistencyScore}, style: ${pr.styleConsistencyScore}, overall: ${pr.overallScore})`);
      console.log(`    Issues: ${pr.issues.join('; ')}`);
      if (pr.suggestedPromptAdditions) {
        console.log(`    Feedback: ${pr.suggestedPromptAdditions.substring(0, 200)}`);
      }
    }
  }

  return bookQCResult;
}

export async function processBookFinalize(job: Job<BookFinalizeJob>) {
  const { bookId, userId } = job.data;
  const qcRound = job.data.qcRound || 0;

  logger.info({ bookId, userId, jobId: job.id, qcRound }, 'Starting book finalization');
  console.log(`[BookFinalize] Starting finalization for book ${bookId} (job: ${job.id}, qcRound: ${qcRound})`);

  try {
    // Get book with all pages
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        pages: {
          orderBy: { pageNumber: 'asc' },
        },
      },
    });

    if (!book) {
      throw new Error('Book not found');
    }

    // Check completion status
    const { storyPages, titlePages } = categorizePages(book.pages, book.coverAssetId);

    const pagesWithText = book.pages.filter((p: any) => p.text && p.text.trim().length > 0);
    const storyPagesWithText = storyPages.filter((p: any) => p.text && p.text.trim().length > 0);
    const pagesWithIllustrations = book.pages.filter((p: any) => p.generatedImageUrl);
    const pagesWithFailedModeration = book.pages.filter((p: any) => p.moderationStatus === 'FAILED');

    const totalPages = book.pages.length;
    const textComplete = storyPagesWithText.length === storyPages.length;
    const illustrationsComplete = pagesWithIllustrations.length === totalPages;

    logger.info({
      bookId,
      totalPages,
      titlePages: titlePages.length,
      storyPages: storyPages.length,
      pagesWithText: pagesWithText.length,
      storyPagesWithText: storyPagesWithText.length,
      pagesWithIllustrations: pagesWithIllustrations.length,
      pagesWithFailedModeration: pagesWithFailedModeration.length,
      textComplete,
      illustrationsComplete,
      qcRound,
    }, 'Book completion status analysis');

    console.log(`[BookFinalize] Book ${bookId} analysis:`)
    console.log(`  - Total Pages: ${totalPages} (${titlePages.length} title, ${storyPages.length} story)`)
    console.log(`  - Story Pages with Text: ${storyPagesWithText.length}/${storyPages.length}`)
    console.log(`  - Pages with Illustrations: ${pagesWithIllustrations.length}/${totalPages}`)
    console.log(`  - Text Complete: ${textComplete}`)
    console.log(`  - Illustrations Complete: ${illustrationsComplete}`)

    // Detailed page analysis
    console.log(`[BookFinalize] Detailed page analysis:`)
    book.pages.forEach((page: any) => {
      const isActualTitlePage = isTitlePage(page.assetId, book.coverAssetId);
      console.log(`  - Page ${page.pageNumber}:`)
      console.log(`    - ID: ${page.id}`)
      console.log(`    - Asset ID: ${page.assetId}`)
      console.log(`    - Cover Asset ID: ${book.coverAssetId}`)
      console.log(`    - Is Title Page (DB): ${page.isTitlePage}`)
      console.log(`    - Is Title Page (Logic): ${isActualTitlePage}`)
      console.log(`    - Has Text: ${!!page.text} (${page.text?.length || 0} chars)`)
      console.log(`    - Has Illustration: ${!!page.generatedImageUrl}`)
      console.log(`    - Moderation Status: ${page.moderationStatus || 'N/A'}`)
    });

    let finalStatus: 'COMPLETED' | 'PARTIAL' | 'FAILED';

    if (textComplete && illustrationsComplete) {
      finalStatus = 'COMPLETED';
    } else if (illustrationsComplete) {
      console.log(`[BookFinalize] All illustrations complete, treating as COMPLETED despite missing text on some pages`);
      finalStatus = 'COMPLETED';
    } else if (pagesWithText.length > 0 || pagesWithIllustrations.length > 0) {
      finalStatus = 'PARTIAL';
    } else {
      finalStatus = 'FAILED';
    }

    // ========================================================================
    // QC CHECK: Run quality check on completed illustrations
    // Only runs if: status would be COMPLETED, and we haven't exceeded max QC rounds
    // ========================================================================
    if (finalStatus === 'COMPLETED' && qcRound < MAX_QC_ROUNDS) {
      try {
        // Get character identity from book record
        const characterIdentity = book.characterIdentity as CharacterIdentity | null;

        const qcPages = book.pages.map((p: any) => ({
          pageNumber: p.pageNumber,
          pageId: p.id,
          generatedImageUrl: p.generatedImageUrl,
        }));

        const qcResult = await runQualityCheck(bookId, qcPages, characterIdentity);

        if (qcResult && !qcResult.passed && qcResult.failedPageIds.length > 0) {
          const nextRound = qcRound + 1;
          qcResult.qcRound = nextRound;

          logger.info({
            bookId,
            qcRound: nextRound,
            failedPages: qcResult.failedPageIds.length,
          }, 'QC failed — re-queuing failed pages for re-illustration');

          console.log(`[BookFinalize/QC] QC round ${nextRound} failed for book ${bookId} — re-queuing ${qcResult.failedPageIds.length} pages`);

          // Build re-illustration jobs for failed pages
          const failedPagesData = book.pages
            .filter((p: any) => qcResult.failedPageIds.includes(p.id))
            .map((p: any) => {
              const pageResult = qcResult.pageResults.find(r => r.pageId === p.id);
              return {
                page: p,
                qcFeedback: pageResult?.suggestedPromptAdditions || null,
              };
            });

          // Clear generated images on failed pages so they get re-generated
          for (const { page } of failedPagesData) {
            await prisma.page.update({
              where: { id: page.id },
              data: {
                generatedImageUrl: null,
                moderationStatus: 'PENDING',
                moderationReason: null,
              },
            });
          }

          // Update book status back to ILLUSTRATING
          await prisma.book.update({
            where: { id: bookId },
            data: { status: 'ILLUSTRATING' },
          });

          // Create FlowProducer flow for re-illustration
          const pageChildren = failedPagesData.map(({ page, qcFeedback }) => ({
            name: `generate-illustration-${bookId}-p${page.pageNumber}-qc${nextRound}`,
            queueName: QUEUE_NAMES.ILLUSTRATION_GENERATION,
            data: {
              userId,
              bookId,
              pageId: page.id,
              pageNumber: page.pageNumber,
              text: page.text,
              artStyle: book.artStyle,
              bookTitle: book.title,
              isTitlePage: page.isTitlePage,
              illustrationNotes: page.illustrationNotes,
              originalImageUrl: page.originalImageUrl,
              characterIdentity,
              qcRound: nextRound,
              qcFeedback,
            },
            opts: {
              attempts: 5,
              backoff: { type: 'exponential' as const, delay: 10000 },
              removeOnComplete: { count: 1000 },
              removeOnFail: { count: 5000 },
              failParentOnFailure: false,
              removeDependencyOnFailure: true,
            },
          }));

          const flowProducer = new FlowProducer({ connection: createBullMQConnection() });

          try {
            const flow = await flowProducer.add({
              name: `finalize-book-${bookId}-qc${nextRound}`,
              queueName: QUEUE_NAMES.BOOK_FINALIZE,
              data: { bookId, userId, qcRound: nextRound },
              opts: {
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 500 },
              },
              children: pageChildren,
            });

            logger.info({
              bookId,
              qcRound: nextRound,
              reIllustrateCount: pageChildren.length,
              flowJobId: flow.job.id,
            }, 'Created QC re-illustration flow');

            console.log(`[BookFinalize/QC] Re-illustration flow created for book ${bookId} (QC round ${nextRound})`);
            console.log(`  - Re-illustrating: ${pageChildren.length} pages`);
            console.log(`  - Flow Job ID: ${flow.job.id}`);
          } finally {
            await flowProducer.close();
          }

          // Return early — the new finalize job will handle completion
          return {
            success: true,
            status: 'QC_REQUEUED',
            qcRound: nextRound,
            failedPages: qcResult.failedPageIds.length,
          };
        }

        // QC passed or couldn't run — proceed with normal completion
        if (qcResult?.passed) {
          console.log(`[BookFinalize/QC] QC passed for book ${bookId} — proceeding with completion`);
        }
      } catch (qcError: any) {
        // QC failure should not block book completion
        logger.error({
          bookId,
          error: qcError.message,
          stack: qcError.stack,
        }, 'QC check failed — proceeding with normal completion');
        console.error(`[BookFinalize/QC] QC error for book ${bookId}: ${qcError.message} — proceeding with completion`);
      }
    } else if (finalStatus === 'COMPLETED' && qcRound >= MAX_QC_ROUNDS) {
      console.log(`[BookFinalize/QC] Max QC rounds (${MAX_QC_ROUNDS}) reached for book ${bookId} — accepting current quality`);
    }

    // Update book status
    await prisma.book.update({
      where: { id: bookId },
      data: {
        status: finalStatus,
        updatedAt: new Date(),
      },
    });

    // Create notification for book completion
    const notificationMessages = {
      COMPLETED: {
        title: `"${book.title}" is ready!`,
        message: `Your book "${book.title}" has been illustrated and is ready to view.`,
      },
      PARTIAL: {
        title: `"${book.title}" is partially ready`,
        message: `Your book "${book.title}" has been partially completed. Some pages may need attention.`,
      },
      FAILED: {
        title: `"${book.title}" needs attention`,
        message: `There was an issue creating your book "${book.title}". Please try again.`,
      },
    };

    const notification = notificationMessages[finalStatus];
    await prisma.notification.create({
      data: {
        userId,
        bookId,
        type: `BOOK_${finalStatus}`,
        title: notification.title,
        message: notification.message,
      },
    });
    logger.info({ bookId, userId, type: `BOOK_${finalStatus}` }, 'Created notification for book completion');

    logger.info({
      bookId,
      finalStatus,
      totalPages,
      pagesWithText: pagesWithText.length,
      pagesWithIllustrations: pagesWithIllustrations.length,
      qcRound,
      jobId: job.id
    }, 'Book finalization completed');

    console.log(`[BookFinalize] Finalization completed for book ${bookId} with status: ${finalStatus}`);

    return {
      success: true,
      status: finalStatus,
      totalPages,
      pagesWithText: pagesWithText.length,
      pagesWithIllustrations: pagesWithIllustrations.length,
      qcRound,
    };

  } catch (error: any) {
    logger.error({ bookId, error: error.message, qcRound }, 'Book finalization failed');

    // Update book status to failed
    await prisma.book.update({
      where: { id: bookId },
      data: { status: 'FAILED' },
    }).catch(() => {}); // Ignore errors when updating status

    throw error;
  }
}
