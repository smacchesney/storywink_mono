import { Job } from 'bullmq';
import prisma from '../database/index.js';
import { IllustrationGenerationJob } from '@storywink/shared/types';
import { GoogleGenAI } from '@google/genai';
import { v2 as cloudinary } from 'cloudinary';
import pino from 'pino';
import util from 'util';
import { createIllustrationPrompt, IllustrationPromptOptions } from '@storywink/shared/prompts/illustration';
// Import STYLE_LIBRARY directly from styles module to avoid barrel export race condition
import { STYLE_LIBRARY, StyleKey } from '@storywink/shared/prompts/styles';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// ============================================================================
// DIAGNOSTIC: Track first job execution for detailed logging
// ============================================================================
// This flag ensures we only log detailed diagnostics once per worker process,
// avoiding log spam while still capturing critical runtime information.
let firstJobExecuted = false;

export async function processIllustrationGeneration(job: Job<IllustrationGenerationJob>) {

  // ============================================================================
  // DIAGNOSTIC: Write job start entry IMMEDIATELY (before ANY processing)
  // ============================================================================
  // This ensures we capture that the job actually started executing, even if
  // it fails immediately. Database writes are committed before logs, so this
  // survives even if the process crashes before stdout buffers flush.
  // ============================================================================
  try {
    await prisma.workerDiagnostic.create({
      data: {
        jobId: job.id || 'unknown',
        jobType: 'illustration',
        attemptNum: (job.attemptsMade || 0) + 1,
        maxAttempts: job.opts?.attempts || 5,
        bookId: job.data?.bookId || 'unknown',
        pageId: job.data?.pageId || 'unknown',
        pageNumber: job.data?.pageNumber || 0,
        errorType: 'job_started',
        errorMessage: 'Job execution started - processing illustration',
        errorStage: 'initialization',
        instanceId: process.env.INSTANCE_ID || 'unknown',
        processId: process.pid,
        hostname: process.env.HOSTNAME || 'unknown',
        railwayCommit: process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
        nodeVersion: process.version,
      },
    });
  } catch (dbError) {
    // If diagnostic write fails, don't block the job - just log the error
    console.error('[DIAGNOSTIC] Failed to write job start diagnostic:', dbError);
  }

  const { bookId, pageId, userId, pageNumber, artStyle, isWinkifyEnabled, illustrationNotes, isTitlePage, bookTitle, text } = job.data;

  console.log(`[IllustrationWorker] Starting job ${job.id} for page ${pageNumber} of book ${bookId}`);
  console.log(`  - PageId: ${pageId}`);
  console.log(`  - Is Title Page: ${isTitlePage}`);
  console.log(`  - Art Style: ${artStyle}`);
  console.log(`  - Has Text: ${!!text} (${text?.length || 0} chars)`);
  console.log(`  - Winkify Enabled: ${isWinkifyEnabled}`);

  try {
    // Validate prerequisites
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('Google API key not configured');
    }

    if (!process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_CLOUD_NAME) {
      throw new Error('Cloudinary API credentials not configured');
    }

    // Configure Cloudinary inside function to ensure env vars are loaded
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    if (!bookId || !pageId || !userId) {
      throw new Error('Missing required job data: bookId, pageId, or userId');
    }

    // Initialize Google AI
    const ai = new GoogleGenAI({
      apiKey: process.env.GOOGLE_API_KEY,
    });
    
    logger.info({ 
      jobId: job.id, 
      userId, 
      bookId, 
      pageId, 
      pageNumber,
      parentJobId: job.parent?.id,
      attemptsMade: job.attemptsMade
    }, 'Processing illustration generation job...');
    
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      include: { 
        book: true,
        asset: true 
      },
    });

    if (!page) {
      throw new Error('Page not found');
    }
    
    // Use isTitlePage from job data (already determined by API)
    // Title pages don't need text (they use book title), but story pages do
    if (!isTitlePage && (!text || text.trim().length === 0)) {
      console.error(`[IllustrationWorker] ERROR: Page ${pageNumber} has no text!`);
      throw new Error('Page has no text - cannot generate illustration without story content');
    }
    
    console.log(`[IllustrationWorker] Page validation passed for page ${pageNumber}`);
    
    // Verify book ownership
    if (page.book.userId !== userId) {
      throw new Error('User does not own this book');
    }
    
    let contentImageBuffer: Buffer | null = null;
    let contentImageMimeType: string | null = null;
    
    const originalImageUrl = page.asset?.url || page.asset?.thumbnailUrl;

    if (originalImageUrl) {
        try {
            logger.info({ jobId: job.id, pageNumber }, `Fetching original content image from ${originalImageUrl}`);
            console.log(`[IllustrationWorker] Fetching original image for page ${pageNumber}...`);
            const imageResponse = await fetch(originalImageUrl);
            if (!imageResponse.ok) {
                throw new Error(`Failed to fetch content image: ${imageResponse.status} ${imageResponse.statusText}`);
            }
            const contentTypeHeader = imageResponse.headers.get('content-type');
            contentImageMimeType = contentTypeHeader?.startsWith('image/') 
                ? contentTypeHeader 
                : (originalImageUrl.endsWith('.png') ? 'image/png' : 'image/jpeg');
            
            const imageArrayBuffer = await imageResponse.arrayBuffer();
            contentImageBuffer = Buffer.from(imageArrayBuffer);
            logger.info({ jobId: job.id, pageNumber }, `Fetched content image (${contentImageMimeType}).`);
        } catch (fetchError: any) {
            logger.error({ jobId: job.id, pageId, pageNumber, error: fetchError.message }, 'Failed to fetch content image.');
            throw fetchError;
        }
    } else {
         logger.error({ jobId: job.id, pageId, pageNumber }, 'Original content image URL is missing.');
         throw new Error('Missing originalImageUrl for illustration generation.');
    }
    
    if (!contentImageBuffer || !contentImageMimeType) {
        logger.error({ jobId: job.id, pageId, pageNumber }, 'Content image buffer or mime type missing.');
        throw new Error('Content image buffer/mime type missing.');
    }

    let styleReferenceBuffer: Buffer | null = null;
    let styleReferenceMimeType: string | null = null;
    const styleKey = artStyle as StyleKey;

    // ============================================================================
    // DIAGNOSTIC: First-job property descriptor logging
    // ============================================================================
    // On the very first job, log the complete internal structure of the
    // STYLE_LIBRARY object. This will show us:
    // - What properties actually exist
    // - Whether they're getters/setters or plain values
    // - The prototype chain
    // - Hidden or enumerable properties
    if (!firstJobExecuted) {
      firstJobExecuted = true;

      console.log('='.repeat(80));
      console.log('[DIAGNOSTIC] First Job Execution - STYLE_LIBRARY Inspection');
      console.log('='.repeat(80));

      console.log('[FirstJob] styles module URL:', import.meta.url);
      console.log('[FirstJob] referenceImageUrl snapshot:', STYLE_LIBRARY.vignette?.referenceImageUrl);

      console.log('[FirstJob] Full STYLE_LIBRARY object:');
      console.log(util.inspect(STYLE_LIBRARY, { depth: 5, showHidden: true, colors: false }));

      console.log('\n[FirstJob] Property descriptors for vignette style:');
      console.log(util.inspect(
        Object.getOwnPropertyDescriptors(STYLE_LIBRARY.vignette),
        { depth: null, colors: false }
      ));

      console.log('\n[FirstJob] Container Information:');
      console.log(`  - Process PID: ${process.pid}`);
      console.log(`  - Hostname: ${process.env.HOSTNAME || 'unknown'}`);
      console.log(`  - Railway Commit: ${process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown'}`);
      console.log(`  - Git Commit: ${process.env.GIT_COMMIT_SHA || 'unknown'}`);
      console.log('='.repeat(80));
    }

    // Defensive check: Ensure STYLE_LIBRARY is loaded (prevent race condition on module import)
    if (!STYLE_LIBRARY || Object.keys(STYLE_LIBRARY).length === 0) {
      logger.error({ jobId: job.id, pageId, pageNumber }, 'STYLE_LIBRARY not loaded - module import race condition detected');
      throw new Error('STYLE_LIBRARY not loaded - please retry');
    }

    const styleData = STYLE_LIBRARY[styleKey];
    if (!styleData) {
      logger.error({ jobId: job.id, pageId, pageNumber, styleKey, availableStyles: Object.keys(STYLE_LIBRARY) }, 'Invalid style key - not found in STYLE_LIBRARY');
      throw new Error(`Invalid style key: ${styleKey}. Available styles: ${Object.keys(STYLE_LIBRARY).join(', ')}`);
    }

    const styleReferenceUrl = styleData.referenceImageUrl;

    // ============================================================================
    // DIAGNOSTIC: Database-persisted logging to survive process crashes
    // ============================================================================
    // CRITICAL: Console logs are being lost due to process crashes/termination.
    // Write diagnostic data to database FIRST, then log to console.
    if (!styleReferenceUrl || styleReferenceUrl.trim().length === 0) {
      // Write to database IMMEDIATELY - survives even SIGKILL
      try {
        await prisma.workerDiagnostic.create({
          data: {
            jobId: job.id,
            jobType: 'illustration',
            attemptNum: job.attemptsMade + 1,
            maxAttempts: job.opts?.attempts || 5,
            bookId,
            pageId,
            pageNumber,
            errorType: 'missing_reference_url',
            errorMessage: `Missing referenceImageUrl for style: ${styleKey}`,
            errorStage: 'style_library_lookup',
            styleKey,
            styleExists: !!styleData,
            hasReferenceImageUrl: 'referenceImageUrl' in styleData,
            referenceImageUrlType: typeof styleData.referenceImageUrl,
            referenceImageUrlValue: String(styleData.referenceImageUrl || 'undefined'),
            availableStyleKeys: JSON.stringify(Object.keys(styleData)),
            instanceId: process.env.INSTANCE_ID || 'unknown',
            processId: process.pid,
            hostname: process.env.HOSTNAME || 'unknown',
            railwayCommit: process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
            nodeVersion: process.version,
          },
        });
      } catch (dbError) {
        // If database write fails, at least try to log it
        console.error('[CRITICAL] Failed to write diagnostic to database:', dbError);
      }

      // Now log to console (may be lost if process crashes)
      console.error('='.repeat(80));
      console.error('[CRITICAL FAILURE] referenceImageUrl Missing');
      console.error('='.repeat(80));
      console.error(`Job: ${job.id} | Page: ${pageNumber} | Style: ${styleKey}`);
      console.error(`Process PID: ${process.pid} | Hostname: ${process.env.HOSTNAME || 'unknown'}`);
      console.error(`Attempt: ${job.attemptsMade + 1}/${job.opts?.attempts || 'unknown'}`);
      console.error(`Railway Commit: ${process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown'}`);
      console.error(`\nSTYLE_LIBRARY state:`);
      console.error(`  - Style exists: ${!!styleData}`);
      console.error(`  - Has referenceImageUrl property: ${'referenceImageUrl' in styleData}`);
      console.error(`  - Value type: ${typeof styleData.referenceImageUrl}`);
      console.error(`  - Value: ${styleData.referenceImageUrl}`);
      console.error(`  - Available keys: ${Object.keys(styleData).join(', ')}`);
      console.error('='.repeat(80));
      console.error('[DIAGNOSTIC] Wrote failure details to WorkerDiagnostic table - query with MCP');

      // Force log flush with small delay to ensure Railway captures output
      await new Promise(resolve => setTimeout(resolve, 500));

      throw new Error(`Missing referenceImageUrl for style: ${styleKey}. Attempt ${job.attemptsMade + 1}/${job.opts?.attempts || 'unknown'}`);
    }

    // Fetch style reference image (we know styleReferenceUrl exists from validation above)
    try {
      logger.info({ jobId: job.id, pageNumber }, `Fetching style reference image from ${styleReferenceUrl}`);
      const styleResponse = await fetch(styleReferenceUrl);
      if (!styleResponse.ok) {
        throw new Error(`Failed to fetch style image: ${styleResponse.status} ${styleResponse.statusText}`);
      }
      const styleContentTypeHeader = styleResponse.headers.get('content-type');
      styleReferenceMimeType = styleContentTypeHeader?.startsWith('image/')
        ? styleContentTypeHeader
        : (styleReferenceUrl.endsWith('.png') ? 'image/png' : 'image/jpeg');
            
      const styleArrayBuffer = await styleResponse.arrayBuffer();
      styleReferenceBuffer = Buffer.from(styleArrayBuffer);
      logger.info({ jobId: job.id, pageNumber }, `Fetched style reference image (${styleReferenceMimeType}).`);
    } catch (fetchError: any) {
      logger.error({ jobId: job.id, pageId, pageNumber, styleKey, error: fetchError.message }, 'Failed to fetch style reference image.');
      throw fetchError;
    }
    
    if (!styleReferenceBuffer || !styleReferenceMimeType) {
        logger.error({ jobId: job.id, pageId, pageNumber }, 'Style reference image buffer or mime type missing.');
        throw new Error('Style reference image buffer/mime type missing.');
    }

    const promptInput: IllustrationPromptOptions = {
        style: styleKey, 
        pageText: text, // Use text from job data
        bookTitle: bookTitle, // Use bookTitle from job data
        isTitlePage: isTitlePage, // Use isTitlePage from job data
        illustrationNotes: illustrationNotes,
        isWinkifyEnabled: isWinkifyEnabled
    };
    
    logger.info({ jobId: job.id, pageId, promptInput }, "Constructed promptInput for createIllustrationPrompt");
    const textPrompt = createIllustrationPrompt(promptInput);
    logger.info({ jobId: job.id, pageId, pageNumber, promptLength: textPrompt.length }, 'Generated illustration prompt.');
    
    console.log(`[IllustrationWorker] Generated prompt for page ${pageNumber}:`);
    console.log(`  - Prompt length: ${textPrompt.length} chars`);
    console.log(`  - First 100 chars: ${textPrompt.substring(0, 100)}...`);

    // Convert images to base64 for Gemini API
    const contentImageBase64 = contentImageBuffer.toString('base64');
    const styleReferenceBase64 = styleReferenceBuffer.toString('base64');

    logger.info({ jobId: job.id, pageId, pageNumber }, 'Prepared images as base64 for Gemini API.');

    let generatedImageBase64: string | null = null;
    let moderationBlocked = false;
    let moderationReasonText: string | null = null;

    try {
       logger.info({ jobId: job.id, pageId, pageNumber }, 'Calling Gemini 3 Pro Image API...');
       console.log(`[IllustrationWorker] Calling Gemini 3 Pro API for page ${pageNumber}...`);

       // Build multi-image prompt for Gemini
       const prompt = [
           {
               inlineData: {
                   mimeType: contentImageMimeType,
                   data: contentImageBase64,
               },
           },
           {
               inlineData: {
                   mimeType: styleReferenceMimeType,
                   data: styleReferenceBase64,
               },
           },
           {
               text: textPrompt
           }
       ];

       const result = await ai.models.generateContent({
           model: "gemini-3-pro-image-preview",
           contents: prompt,
           config: {
               responseModalities: ['TEXT', 'IMAGE'],
               imageConfig: {
                   aspectRatio: '1:1',
                   imageSize: '2K',
               },
           },
       });

       logger.info({ jobId: job.id, pageId, pageNumber }, 'Received response from Gemini.');
       console.log(`[IllustrationWorker] Gemini API response received for page ${pageNumber}`);

        // Extract image data from Gemini response
        const imagePart = result?.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData);
        if (imagePart?.inlineData?.data) {
            generatedImageBase64 = imagePart.inlineData.data;
            logger.info({ jobId: job.id, pageId, pageNumber }, 'Extracted generated image data from Gemini response.');
        } else {
            moderationBlocked = true;
            moderationReasonText = "Image generation failed or blocked by content policy (no image data in response).";
            logger.warn({ jobId: job.id, pageId, pageNumber, response: JSON.stringify(result) }, 'Gemini response did not contain image data.');
        }

    } catch (apiError: any) {
        // Extract detailed error information from Google API response
        const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
        const errorCode = apiError?.code || apiError?.response?.status;
        const errorDetails = apiError?.response?.data || apiError?.details;

        // Check for specific error types
        const isSafetyBlock = errorMessage.toLowerCase().includes('safety') ||
                              errorMessage.toLowerCase().includes('blocked') ||
                              errorMessage.toLowerCase().includes('content policy');
        const isCopyrightIssue = errorMessage.toLowerCase().includes('copyright') ||
                                 errorMessage.toLowerCase().includes('proprietary') ||
                                 errorMessage.toLowerCase().includes('trademark');
        const isQuotaIssue = errorMessage.toLowerCase().includes('quota') ||
                             errorMessage.toLowerCase().includes('rate limit');

        logger.error({
            jobId: job.id,
            pageId,
            pageNumber,
            error: errorMessage,
            errorCode,
            errorDetails,
            isSafetyBlock,
            isCopyrightIssue,
            isQuotaIssue,
            fullError: JSON.stringify(apiError, null, 2)
        }, 'Error calling Gemini 3 Pro Image API.');

        console.error(`[IllustrationWorker] Gemini API error for page ${pageNumber}:`);
        console.error(`  - Error: ${errorMessage}`);
        console.error(`  - Error Code: ${errorCode || 'N/A'}`);
        if (isSafetyBlock) console.error(`  - Type: SAFETY/CONTENT POLICY BLOCK`);
        if (isCopyrightIssue) console.error(`  - Type: COPYRIGHT/PROPRIETARY ISSUE`);
        if (isQuotaIssue) console.error(`  - Type: QUOTA/RATE LIMIT`);
        if (errorDetails) console.error(`  - Details: ${JSON.stringify(errorDetails)}`);

        moderationBlocked = true;
        moderationReasonText = `${errorMessage}${errorCode ? ` (Code: ${errorCode})` : ''}${isSafetyBlock ? ' [SAFETY]' : ''}${isCopyrightIssue ? ' [COPYRIGHT]' : ''}`;
    }
    
    let finalImageUrl: string | undefined = undefined;
    if (generatedImageBase64 && !moderationBlocked) {
      try {
          logger.info({ jobId: job.id, pageId, pageNumber }, 'Decoding and uploading generated image to Cloudinary...');
          const generatedImageBuffer = Buffer.from(generatedImageBase64, 'base64');
          
          const uploadResult = await new Promise<any>((resolve, reject) => {
               cloudinary.uploader.upload_stream(
                   {
                       folder: `storywink/${bookId}/generated`, 
                       public_id: `page_${pageNumber}`,
                       overwrite: true,
                       tags: [`book:${bookId}`, `page:${pageId}`, `pageNum:${pageNumber}`, `style:${styleKey}`],
                       resource_type: "image"
                   },
                   (error, result) => {
                       if (error) { reject(error); } else { resolve(result); }
                   }
               ).end(generatedImageBuffer);
          });

          if (!uploadResult?.secure_url) {
              throw new Error('Cloudinary upload did not return a secure URL.');
          }
          finalImageUrl = uploadResult.secure_url;
          logger.info({ jobId: job.id, pageId, pageNumber, cloudinaryUrl: finalImageUrl }, 'Successfully uploaded generated image to Cloudinary');
          console.log(`[IllustrationWorker] Image uploaded for page ${pageNumber}: ${finalImageUrl}`);

      } catch (uploadError: any) {
          logger.error({ jobId: job.id, pageId, pageNumber, error: uploadError.message }, 'Failed to upload generated image to Cloudinary.');
          moderationBlocked = true;
          moderationReasonText = moderationReasonText || `Cloudinary upload failed: ${uploadError.message}`;
      }
    }

    try {
        await prisma.page.update({
            where: { id: pageId },
            data: {
                generatedImageUrl: !moderationBlocked ? finalImageUrl : null,
                moderationStatus: moderationBlocked ? "FLAGGED" : "OK",
                moderationReason: moderationReasonText,
            },
        });
        logger.info({ 
            jobId: job.id, 
            pageId, 
            pageNumber, 
            status: moderationBlocked ? "FLAGGED" : "OK",
            reason: moderationReasonText
        }, 'Page status updated.');
        
        console.log(`[IllustrationWorker] Page ${pageNumber} completed:`);
        console.log(`  - Status: ${moderationBlocked ? "FLAGGED" : "OK"}`);
        console.log(`  - Generated Image: ${finalImageUrl ? 'Success' : 'Failed'}`);
        if (moderationReasonText) {
          console.log(`  - Reason: ${moderationReasonText}`);
        }
    } catch (dbError: any) {
         logger.error({ jobId: job.id, pageId, pageNumber, error: dbError.message }, 'Failed to update page status in database.');
         throw dbError; 
    }

    // The book-finalize worker will handle status updates
    // We don't need to check completion here anymore
    
    console.log(`[IllustrationWorker] Job ${job.id} completed successfully for page ${pageNumber}`);
    
    return { 
      success: true, 
      imageUrl: finalImageUrl,
      pageNumber,
      moderationStatus: moderationBlocked ? "FLAGGED" : "OK"
    };
    
  } catch (error: any) {
    // Enhanced error logging with more context
    const errorContext = {
      bookId, 
      pageId, 
      error: error.message,
      errorStack: error.stack,
      pageNumber,
      jobId: job.id,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts?.attempts || 'unknown',
      parentJobId: job.parent?.id,
      isTitlePage,
      artStyle,
      isWinkifyEnabled,
      hasText: !!text,
      textLength: text?.length || 0,
      // Add more diagnostic info
      failureStage: error.message.includes('Gemini') || error.message.includes('Google') ? 'ai_generation' :
                   error.message.includes('Cloudinary') ? 'image_upload' :
                   error.message.includes('fetch') ? 'image_fetch' :
                   error.message.includes('database') ? 'database_update' : 'unknown'
    };
    
    logger.error(errorContext, 'Illustration generation failed');

    console.error(`[IllustrationWorker] Job ${job.id} FAILED for page ${pageNumber}:`);
    console.error(`  - Book: ${bookId}`);
    console.error(`  - Error: ${error.message}`);
    console.error(`  - Failure Stage: ${errorContext.failureStage}`);
    console.error(`  - Attempts: ${job.attemptsMade + 1}/${job.opts?.attempts || 'unknown'}`);
    console.error(`  - Parent Job: ${job.parent?.id || 'None'}`);
    console.error(`  - Is Title Page: ${isTitlePage}`);
    console.error(`  - Has Text: ${!!text} (${text?.length || 0} chars)`);
    console.error(`  - Art Style: ${artStyle}`);

    // Mark page as failed with enhanced error info
    try {
      await prisma.page.update({
        where: { id: pageId },
        data: {
          moderationStatus: 'FAILED',
          moderationReason: `Job failed (${errorContext.failureStage}): ${error.message}`.slice(0, 1000),
        },
      });
      console.error(`[IllustrationWorker] Page ${pageNumber} marked as FAILED in database`);
    } catch (updateError: any) {
       logger.error({ jobId: job.id, bookId, error: updateError.message }, 'Failed to update page status to FAILED after job error.');
       console.error(`[IllustrationWorker] WARNING: Could not mark page ${pageNumber} as failed in database: ${updateError.message}`);
    }

    // Force log flush delay before throwing to ensure Railway captures logs
    await new Promise(resolve => setTimeout(resolve, 500));

    throw error;
  }
}