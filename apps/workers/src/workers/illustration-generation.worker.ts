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
// Text overlay for story pages, logo overlay for title pages, upscaling for print
import { addTextToImage, addLogoToTitlePage, upscaleForPrint } from '../utils/text-overlay.js';

// Character data type for face references
interface CharacterFace {
  name: string;
  buffer: Buffer;
  mimeType: string;
}

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Detect transient errors that should trigger automatic retry.
 * Content policy errors are NOT transient - they won't resolve on retry.
 */
function isTransientError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const transientPatterns = [
    'fetch failed',
    'etimedout',
    'econnreset',
    'econnrefused',
    'enotfound',
    'socket hang up',
    'network error',
    'timeout',
    'aborted',
    'unavailable',
    '503',
    'internal error',
    'deadline exceeded',
    'rate limit',
    '429',
    'quota exceeded',
    'resource exhausted',
    // Text overlay errors (retry-able)
    'text overlay failed',
    'font file not found',
    'sharp',
  ];
  return transientPatterns.some(pattern => message.includes(pattern));
}

/**
 * Check if this is the last retry attempt for a job.
 */
function isLastAttempt(job: Job): boolean {
  const maxAttempts = job.opts?.attempts || 1;
  return (job.attemptsMade + 1) >= maxAttempts;
}

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

  const { bookId, pageId, userId, pageNumber, artStyle, illustrationNotes, isTitlePage, bookTitle, characterNames: jobCharacterNames, text } = job.data;

  console.log(`[IllustrationWorker] Starting job ${job.id} for page ${pageNumber} of book ${bookId}`);
  console.log(`  - PageId: ${pageId}`);
  console.log(`  - Is Title Page: ${isTitlePage}`);
  console.log(`  - Art Style: ${artStyle}`);
  console.log(`  - Has Text: ${!!text} (${text?.length || 0} chars)`);
  console.log(`  - Illustration Notes: ${illustrationNotes ? 'Yes' : 'None'}`);

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
      console.log('[FirstJob] referenceImageUrls snapshot:', STYLE_LIBRARY.vignette?.referenceImageUrls);

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

    // Get style reference URLs - title pages use single cover ref, story pages use array of refs
    let styleReferenceUrls: string[];
    if (isTitlePage && styleData.coverReferenceImageUrl) {
      styleReferenceUrls = [styleData.coverReferenceImageUrl];
    } else {
      // Spread to convert readonly array to mutable array
      styleReferenceUrls = [...styleData.referenceImageUrls];
    }

    // ============================================================================
    // DIAGNOSTIC: Database-persisted logging to survive process crashes
    // ============================================================================
    // CRITICAL: Console logs are being lost due to process crashes/termination.
    // Write diagnostic data to database FIRST, then log to console.
    if (!styleReferenceUrls || styleReferenceUrls.length === 0) {
      // Write to database IMMEDIATELY - survives even SIGKILL
      try {
        await prisma.workerDiagnostic.create({
          data: {
            jobId: job.id || 'unknown',
            jobType: 'illustration',
            attemptNum: job.attemptsMade + 1,
            maxAttempts: job.opts?.attempts || 5,
            bookId,
            pageId,
            pageNumber,
            errorType: 'missing_reference_url',
            errorMessage: `Missing referenceImageUrls for style: ${styleKey}`,
            errorStage: 'style_library_lookup',
            styleKey,
            styleExists: !!styleData,
            hasReferenceImageUrl: 'referenceImageUrls' in styleData,
            referenceImageUrlType: typeof styleData.referenceImageUrls,
            referenceImageUrlValue: String(styleData.referenceImageUrls || 'undefined'),
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
      console.error('[CRITICAL FAILURE] referenceImageUrls Missing');
      console.error('='.repeat(80));
      console.error(`Job: ${job.id} | Page: ${pageNumber} | Style: ${styleKey}`);
      console.error(`Process PID: ${process.pid} | Hostname: ${process.env.HOSTNAME || 'unknown'}`);
      console.error(`Attempt: ${job.attemptsMade + 1}/${job.opts?.attempts || 'unknown'}`);
      console.error(`Railway Commit: ${process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown'}`);
      console.error(`\nSTYLE_LIBRARY state:`);
      console.error(`  - Style exists: ${!!styleData}`);
      console.error(`  - Has referenceImageUrls property: ${'referenceImageUrls' in styleData}`);
      console.error(`  - Value type: ${typeof styleData.referenceImageUrls}`);
      console.error(`  - Value: ${styleData.referenceImageUrls}`);
      console.error(`  - Available keys: ${Object.keys(styleData).join(', ')}`);
      console.error('='.repeat(80));
      console.error('[DIAGNOSTIC] Wrote failure details to WorkerDiagnostic table - query with MCP');

      // Force log flush with small delay to ensure Railway captures output
      await new Promise(resolve => setTimeout(resolve, 500));

      throw new Error(`Missing referenceImageUrls for style: ${styleKey}. Attempt ${job.attemptsMade + 1}/${job.opts?.attempts || 'unknown'}`);
    }

    // Fetch all style reference images
    const styleReferenceBuffers: Array<{ buffer: Buffer; mimeType: string }> = [];

    for (const styleRefUrl of styleReferenceUrls) {
      try {
        logger.info({ jobId: job.id, pageNumber }, `Fetching style reference image from ${styleRefUrl}`);
        const styleResponse = await fetch(styleRefUrl);
        if (!styleResponse.ok) {
          throw new Error(`Failed to fetch style image: ${styleResponse.status} ${styleResponse.statusText}`);
        }
        const styleContentTypeHeader = styleResponse.headers.get('content-type');
        const mimeType = styleContentTypeHeader?.startsWith('image/')
          ? styleContentTypeHeader
          : (styleRefUrl.endsWith('.png') ? 'image/png' : 'image/jpeg');

        const styleArrayBuffer = await styleResponse.arrayBuffer();
        styleReferenceBuffers.push({
          buffer: Buffer.from(styleArrayBuffer),
          mimeType,
        });
        logger.info({ jobId: job.id, pageNumber }, `Fetched style reference image (${mimeType}).`);
      } catch (fetchError: any) {
        logger.error({ jobId: job.id, pageId, pageNumber, styleKey, error: fetchError.message }, 'Failed to fetch style reference image.');
        throw fetchError;
      }
    }

    if (styleReferenceBuffers.length === 0) {
        logger.error({ jobId: job.id, pageId, pageNumber }, 'No style reference images fetched successfully.');
        throw new Error('No style reference images fetched.');
    }

    console.log(`[IllustrationWorker] Fetched ${styleReferenceBuffers.length} style reference image(s) for page ${pageNumber}`);

    // Fetch character face images for visual consistency
    const characterFaces: CharacterFace[] = [];
    const characterNames: string[] = [];

    try {
      const characters = await prisma.character.findMany({
        where: { bookId },
        orderBy: { displayOrder: 'asc' },
        select: {
          name: true,
          croppedFaceUrl: true,
        },
      });

      if (characters.length > 0) {
        logger.info({ jobId: job.id, pageNumber, characterCount: characters.length }, 'Fetching character face images...');
        console.log(`[IllustrationWorker] Fetching ${characters.length} character face image(s) for page ${pageNumber}`);

        for (const char of characters) {
          try {
            const faceResponse = await fetch(char.croppedFaceUrl);
            if (!faceResponse.ok) {
              logger.warn({ jobId: job.id, pageNumber, characterName: char.name, status: faceResponse.status }, 'Failed to fetch character face, skipping');
              continue;
            }
            const faceContentType = faceResponse.headers.get('content-type');
            const mimeType = faceContentType?.startsWith('image/')
              ? faceContentType
              : 'image/jpeg';
            const faceArrayBuffer = await faceResponse.arrayBuffer();

            characterFaces.push({
              name: char.name,
              buffer: Buffer.from(faceArrayBuffer),
              mimeType,
            });
            characterNames.push(char.name);
            logger.info({ jobId: job.id, pageNumber, characterName: char.name }, 'Character face image fetched');
          } catch (faceError: any) {
            logger.warn({ jobId: job.id, pageNumber, characterName: char.name, error: faceError.message }, 'Error fetching character face, skipping');
          }
        }

        console.log(`[IllustrationWorker] Fetched ${characterFaces.length} of ${characters.length} character face images`);
      }
    } catch (charError: any) {
      logger.warn({ jobId: job.id, pageNumber, error: charError.message }, 'Error fetching characters, continuing without character references');
    }

    const promptInput: IllustrationPromptOptions = {
        style: styleKey,
        pageText: text, // Use text from job data
        bookTitle: bookTitle, // Use bookTitle from job data
        isTitlePage: isTitlePage, // Use isTitlePage from job data
        illustrationNotes: illustrationNotes,
        referenceImageCount: styleReferenceBuffers.length, // Tell prompt how many refs we're sending
        // Character names for title page subtitle - use from job data first, fallback to fetched names
        characterNames: (jobCharacterNames && jobCharacterNames.length > 0)
            ? jobCharacterNames
            : (characterNames.length > 0 ? characterNames : undefined),
        characterFaceCount: characterFaces.length > 0 ? characterFaces.length : undefined,
    };
    
    logger.info({ jobId: job.id, pageId, promptInput }, "Constructed promptInput for createIllustrationPrompt");
    const textPrompt = createIllustrationPrompt(promptInput);
    logger.info({ jobId: job.id, pageId, pageNumber, promptLength: textPrompt.length }, 'Generated illustration prompt.');
    
    console.log(`[IllustrationWorker] Generated prompt for page ${pageNumber}:`);
    console.log(`  - Prompt length: ${textPrompt.length} chars`);
    console.log(`  - First 100 chars: ${textPrompt.substring(0, 100)}...`);

    // Convert content image to base64 for Gemini API
    const contentImageBase64 = contentImageBuffer.toString('base64');

    logger.info({ jobId: job.id, pageId, pageNumber, refCount: styleReferenceBuffers.length }, 'Prepared images as base64 for Gemini API.');

    let generatedImageBase64: string | null = null;
    let moderationBlocked = false;
    let moderationReasonText: string | null = null;

    try {
       logger.info({ jobId: job.id, pageId, pageNumber }, 'Calling Gemini 3 Pro Image API...');
       console.log(`[IllustrationWorker] Calling Gemini 3 Pro API for page ${pageNumber} with ${styleReferenceBuffers.length} style ref(s)...`);

       // Build multi-image prompt for Gemini
       // Order: Content image, Character faces (if any), Style references, Text prompt
       const prompt = [
           // 1. Content image (user's photo)
           {
               inlineData: {
                   mimeType: contentImageMimeType,
                   data: contentImageBase64,
               },
           },
           // 2. Character face images (for visual consistency)
           ...characterFaces.map(char => ({
               inlineData: {
                   mimeType: char.mimeType,
                   data: char.buffer.toString('base64'),
               },
           })),
           // 3. Style reference image(s) - 1 for title pages, 2 for story pages
           ...styleReferenceBuffers.map(ref => ({
               inlineData: {
                   mimeType: ref.mimeType,
                   data: ref.buffer.toString('base64'),
               },
           })),
           // 4. Text prompt
           {
               text: textPrompt
           }
       ];

       logger.info({
           jobId: job.id,
           pageNumber,
           imageCount: 1 + characterFaces.length + styleReferenceBuffers.length,
           contentImage: 1,
           characterFaces: characterFaces.length,
           styleRefs: styleReferenceBuffers.length,
       }, 'Prepared Gemini prompt with images');

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
        const isContentPolicyBlock = isSafetyBlock || isCopyrightIssue;

        logger.error({
            jobId: job.id,
            pageId,
            pageNumber,
            error: errorMessage,
            errorCode,
            errorDetails,
            isSafetyBlock,
            isCopyrightIssue,
            isContentPolicyBlock,
            fullError: JSON.stringify(apiError, null, 2)
        }, 'Error calling Gemini 3 Pro Image API.');

        console.error(`[IllustrationWorker] Gemini API error for page ${pageNumber}:`);
        console.error(`  - Error: ${errorMessage}`);
        console.error(`  - Error Code: ${errorCode || 'N/A'}`);
        console.error(`  - Is Content Policy Block: ${isContentPolicyBlock}`);
        if (isSafetyBlock) console.error(`  - Type: SAFETY/CONTENT POLICY BLOCK`);
        if (isCopyrightIssue) console.error(`  - Type: COPYRIGHT/PROPRIETARY ISSUE`);
        if (errorDetails) console.error(`  - Details: ${JSON.stringify(errorDetails)}`);

        // Content policy violations are PERMANENT - mark as FLAGGED, complete job successfully (no retry)
        if (isContentPolicyBlock) {
            moderationBlocked = true;
            moderationReasonText = `${errorMessage}${errorCode ? ` (Code: ${errorCode})` : ''}${isSafetyBlock ? ' [SAFETY]' : ''}${isCopyrightIssue ? ' [COPYRIGHT]' : ''}`;
            console.log(`[IllustrationWorker] Content policy block - marking as FLAGGED, job will complete successfully (no retry)`);
            // Don't throw - let job complete successfully with FLAGGED status
        } else {
            // Other API errors (possibly transient) - re-throw to trigger outer catch block retry logic
            console.log(`[IllustrationWorker] API error (possibly transient) - re-throwing for retry logic`);
            throw apiError;
        }
    }
    
    let finalImageUrl: string | undefined = undefined;
    if (generatedImageBase64 && !moderationBlocked) {
      try {
          logger.info({ jobId: job.id, pageId, pageNumber }, 'Decoding and uploading generated image to Cloudinary...');
          let generatedImageBuffer = Buffer.from(generatedImageBase64, 'base64');

          // Upscale from Gemini 2K (2048×2048) to Lulu print size (2625×2625)
          // This ensures 300 DPI quality for 8.75" × 8.75" print with bleed
          try {
              logger.info({ jobId: job.id, pageId, pageNumber }, 'Upscaling image for print quality (2048 → 2625px)...');
              console.log(`[IllustrationWorker] Upscaling page ${pageNumber} to 2625×2625 for print`);
              generatedImageBuffer = await upscaleForPrint(generatedImageBuffer);
              logger.info({ jobId: job.id, pageId, pageNumber }, 'Image upscaled successfully.');
          } catch (upscaleError: any) {
              const errorMessage = `Image upscaling failed: ${upscaleError.message}`;
              logger.error({
                  jobId: job.id,
                  pageId,
                  pageNumber,
                  error: upscaleError.message,
                  stack: upscaleError.stack,
              }, errorMessage);
              console.error(`[IllustrationWorker] Upscaling failed for page ${pageNumber}: ${upscaleError.message}`);
              throw new Error(errorMessage);
          }

          // Add text overlay for story pages (not title pages)
          if (!isTitlePage && text && text.trim().length > 0) {
              try {
                  logger.info({ jobId: job.id, pageId, pageNumber }, 'Adding text overlay to story page...');
                  console.log(`[IllustrationWorker] Adding text overlay to page ${pageNumber}: "${text.substring(0, 50)}..."`);
                  generatedImageBuffer = await addTextToImage(generatedImageBuffer, text);
                  logger.info({ jobId: job.id, pageId, pageNumber }, 'Text overlay added successfully.');
                  console.log(`[IllustrationWorker] Text overlay complete for page ${pageNumber}`);
              } catch (textOverlayError: any) {
                  // Text overlay failure should be retried, not silently skipped
                  const errorMessage = `Text overlay failed: ${textOverlayError.message}`;
                  logger.error({
                      jobId: job.id,
                      pageId,
                      pageNumber,
                      error: textOverlayError.message,
                      stack: textOverlayError.stack,
                  }, errorMessage);
                  console.error(`[IllustrationWorker] Text overlay failed for page ${pageNumber}: ${textOverlayError.message}`);
                  console.error(`[IllustrationWorker] Stack: ${textOverlayError.stack}`);
                  // Throw to trigger retry logic - will be marked FAILED after exhausting retries
                  throw new Error(errorMessage);
              }
          }

          // Add Storywink.ai logo to title pages
          if (isTitlePage) {
              try {
                  logger.info({ jobId: job.id, pageId, pageNumber }, 'Adding logo overlay to title page...');
                  console.log(`[IllustrationWorker] Adding Storywink.ai logo to title page ${pageNumber}`);
                  generatedImageBuffer = await addLogoToTitlePage(generatedImageBuffer);
                  logger.info({ jobId: job.id, pageId, pageNumber }, 'Logo overlay added successfully.');
                  console.log(`[IllustrationWorker] Logo overlay complete for page ${pageNumber}`);
              } catch (logoOverlayError: any) {
                  // Logo overlay failure should be retried, not silently skipped
                  const errorMessage = `Logo overlay failed: ${logoOverlayError.message}`;
                  logger.error({
                      jobId: job.id,
                      pageId,
                      pageNumber,
                      error: logoOverlayError.message,
                      stack: logoOverlayError.stack,
                  }, errorMessage);
                  console.error(`[IllustrationWorker] Logo overlay failed for page ${pageNumber}: ${logoOverlayError.message}`);
                  console.error(`[IllustrationWorker] Stack: ${logoOverlayError.stack}`);
                  // Throw to trigger retry logic - will be marked FAILED after exhausting retries
                  throw new Error(errorMessage);
              }
          }

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
    const errorMessage = error instanceof Error ? error.message : String(error);
    const transient = isTransientError(error);
    const lastAttempt = isLastAttempt(job);
    const willRetry = transient && !lastAttempt;

    // Enhanced error logging with retry context
    const errorContext = {
      bookId,
      pageId,
      error: errorMessage,
      errorStack: error.stack,
      pageNumber,
      jobId: job.id,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts?.attempts || 5,
      isTransient: transient,
      isLastAttempt: lastAttempt,
      willRetry,
      parentJobId: job.parent?.id,
      isTitlePage,
      artStyle,
      hasIllustrationNotes: !!illustrationNotes,
      hasText: !!text,
      textLength: text?.length || 0,
      failureStage: errorMessage.includes('text overlay') || errorMessage.includes('Text overlay') ? 'text_overlay' :
                   errorMessage.includes('Gemini') || errorMessage.includes('Google') ? 'ai_generation' :
                   errorMessage.includes('Cloudinary') ? 'image_upload' :
                   errorMessage.includes('fetch') ? 'image_fetch' :
                   errorMessage.includes('database') ? 'database_update' : 'unknown'
    };

    logger.error(errorContext, 'Illustration generation error');

    console.error(`[IllustrationWorker] Job ${job.id} ERROR for page ${pageNumber}:`);
    console.error(`  - Book: ${bookId}`);
    console.error(`  - Error: ${errorMessage}`);
    console.error(`  - Failure Stage: ${errorContext.failureStage}`);
    console.error(`  - Transient Error: ${transient}`);
    console.error(`  - Attempt: ${job.attemptsMade + 1}/${job.opts?.attempts || 5}`);
    console.error(`  - Will Retry: ${willRetry}`);

    // TRANSIENT + NOT LAST ATTEMPT: Re-throw WITHOUT updating page status
    // BullMQ will retry automatically with exponential backoff
    if (willRetry) {
      console.log(`[IllustrationWorker] Transient error detected - BullMQ will retry automatically`);
      await new Promise(resolve => setTimeout(resolve, 100)); // Flush logs
      throw error;
    }

    // PERMANENT ERROR or LAST ATTEMPT: Mark page as FAILED
    console.error(`[IllustrationWorker] Marking page ${pageNumber} as FAILED (permanent error or final attempt)`);

    try {
      await prisma.page.update({
        where: { id: pageId },
        data: {
          moderationStatus: 'FAILED',
          moderationReason: `Job failed (${errorContext.failureStage}): ${errorMessage}`.slice(0, 1000),
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