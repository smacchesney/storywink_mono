import { Job } from 'bullmq';
import prisma from '../database/index.js';
import { IllustrationGenerationJob } from '../shared/index.js';
import OpenAI, { toFile } from 'openai';
import { FileLike } from 'openai/uploads';
import { v2 as cloudinary } from 'cloudinary';
import pino from 'pino';
import { createIllustrationPrompt, IllustrationPromptOptions, STYLE_LIBRARY, StyleKey } from '@storywink/shared';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export async function processIllustrationGeneration(job: Job<IllustrationGenerationJob>) {
  
  const { bookId, pageId, userId, pageNumber, artStyle, isWinkifyEnabled, illustrationNotes, isTitlePage, bookTitle, text } = job.data;
  
  console.log(`[IllustrationWorker] Starting job ${job.id} for page ${pageNumber} of book ${bookId}`);
  console.log(`  - PageId: ${pageId}`);
  console.log(`  - Is Title Page: ${isTitlePage}`);
  console.log(`  - Art Style: ${artStyle}`);
  console.log(`  - Has Text: ${!!text} (${text?.length || 0} chars)`);
  console.log(`  - Winkify Enabled: ${isWinkifyEnabled}`);
  
  try {
    // Validate prerequisites
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
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

    // Initialize OpenAI
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
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
    const styleData = STYLE_LIBRARY[styleKey];
    const styleReferenceUrl = styleData?.referenceImageUrl;

    if (styleReferenceUrl) {
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
    } else {
         logger.error({ jobId: job.id, pageId, pageNumber, styleKey }, 'Style reference image URL is missing for the selected style.');
         throw new Error(`Missing referenceImageUrl for style: ${styleKey}`);
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

    const contentFileExt = contentImageMimeType?.split('/')[1] || 'jpg';
    const contentFileName = `page_${pageNumber}_content.${contentFileExt}`;
    const contentImageFile = await toFile(
        contentImageBuffer,
        contentFileName,
        { type: contentImageMimeType }
    );
    logger.info({ jobId: job.id, pageId, pageNumber }, 'Prepared content image file for API.');

    const styleFileExt = styleReferenceMimeType?.split('/')[1] || 'jpg';
    const styleFileName = `${styleKey}_ref.${styleFileExt}`;
    const styleReferenceImageFile = await toFile(
        styleReferenceBuffer,
        styleFileName,
        { type: styleReferenceMimeType }
    );
    logger.info({ jobId: job.id, pageId, pageNumber }, 'Prepared style reference image file for API.');

    const imageInputArray: FileLike[] = [contentImageFile, styleReferenceImageFile];

    let generatedImageBase64: string | null = null;
    let moderationBlocked = false;
    let moderationReasonText: string | null = null;
    
    try {
       logger.info({ jobId: job.id, pageId, pageNumber }, 'Calling OpenAI gpt-image-1 API...');
       console.log(`[IllustrationWorker] Calling OpenAI API for page ${pageNumber}...`);

       const result = await openai.images.edit({
           model: "gpt-image-1",
           image: imageInputArray as any, // Array of up to 10 images supported by gpt-image-1
           prompt: textPrompt, 
           n: 1,
           size: "1024x1024"
           // Note: gpt-image-1 returns base64 by default, no response_format needed
       });

       logger.info({ jobId: job.id, pageId, pageNumber }, 'Received response from OpenAI.');
       console.log(`[IllustrationWorker] OpenAI API response received for page ${pageNumber}`);

        if (result?.data?.[0]?.revised_prompt && result.data[0].revised_prompt !== textPrompt) {
            logger.warn({ jobId: job.id, pageId, pageNumber, originalLength: textPrompt.length, revisedLength: result.data[0].revised_prompt?.length }, 'OpenAI revised the prompt.');
        }

        const b64ImageData = result?.data?.[0]?.b64_json;
        if (b64ImageData) {
            generatedImageBase64 = b64ImageData;
            logger.info({ jobId: job.id, pageId, pageNumber }, 'Extracted generated image data (b64_json).');
        } else {
            moderationBlocked = true;
            moderationReasonText = "Image generation failed or blocked by content policy (no b64_json data)."; 
            logger.warn({ jobId: job.id, pageId, pageNumber, response: JSON.stringify(result) }, 'OpenAI response did not contain b64_json image data.');
        }

    } catch (apiError: any) {
        logger.error({ 
            jobId: job.id, 
            pageId, 
            pageNumber, 
            error: apiError instanceof Error ? apiError.message : String(apiError),
            ...(apiError?.response?.data && { responseData: apiError.response.data }) 
        }, 'Error calling OpenAI gpt-image-1 API.');
        console.error(`[IllustrationWorker] OpenAI API error for page ${pageNumber}:`, apiError.message);
        moderationBlocked = true;
        moderationReasonText = apiError instanceof Error ? apiError.message : String(apiError);
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
    logger.error({ 
      bookId, 
      pageId, 
      error: error.message,
      pageNumber,
      jobId: job.id,
      attemptsMade: job.attemptsMade 
    }, 'Illustration generation failed');
    
    console.error(`[IllustrationWorker] Job ${job.id} FAILED for page ${pageNumber}:`);
    console.error(`  - Error: ${error.message}`);
    console.error(`  - Attempts: ${job.attemptsMade}/${job.opts.attempts}`);
    
    // Mark page as failed
    try {
      await prisma.page.update({
        where: { id: pageId },
        data: { 
          moderationStatus: 'FAILED',
          moderationReason: `Job failed: ${error.message}`.slice(0, 1000),
        },
      });
    } catch (updateError: any) {
       logger.error({ jobId: job.id, bookId, error: updateError.message }, 'Failed to update page status to FAILED after job error.');
    }
    
    throw error;
  }
}