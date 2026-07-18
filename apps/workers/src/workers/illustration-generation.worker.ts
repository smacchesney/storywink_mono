import { Job } from 'bullmq';
import prisma from '../database/index.js';
import { IllustrationGenerationJobV2 } from '@storywink/shared/types';
import {
  getEscalationIllustrator,
  getGeminiFallbackIllustrator,
  getIllustrator,
} from '../lib/illustrators/index.js';
import type { IllustrationInput, IllustrationProvider } from '../lib/illustrators/index.js';
import { maybeGeminiFallback } from '../lib/illustrators/fallback.js';
import { shouldNeutralizeNames } from '../lib/illustrators/neutralize.js';
import { toysComeAliveEnabled } from '../lib/toys-come-alive.js';
import { storyIllusMoodEnabled } from '../lib/story-quality.js';
import type { EscalationJobFields } from '../lib/escalation.js';
import { v2 as cloudinary } from 'cloudinary';
import pino from 'pino';
import {
  createIllustrationPrompt,
  IllustrationPromptOptions,
} from '@storywink/shared/prompts/illustration';
import type { BridgeScene } from '@storywink/shared/prompts/story';
import { resolveBridgeAnchor } from '../lib/bridge-pages.js';
import { orderCharacterSheets, selectSceneSheets } from '../lib/avatar-story.js';
import { speciesLineFor, kindFromRole } from '@storywink/shared/prompts/character-identity';
// Import STYLE_LIBRARY directly from styles module to avoid barrel export race condition
import { STYLE_LIBRARY, StyleKey } from '@storywink/shared/prompts/styles';
import { optimizeCloudinaryUrlForVision, convertHeicToJpeg } from '@storywink/shared/utils';
// Upscaling for print (the cover's logo overlay lives in lib/cover-generation)
import { upscaleForPrint } from '../utils/image-processing.js';
import { characterSheetsEnabled } from '../lib/character-sheets.js';
import { capStyleRefs, styleRefsCapForProvider } from '../lib/style-refs.js';
import { generateAndStoreCover } from '../lib/cover-generation.js';
import { fetchImageInput, resizeForReference } from '../lib/images.js';
import type { IllustrationImageInput } from '../lib/illustrators/index.js';

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
    // Image processing errors (retry-able)
    'sharp',
    // OpenAI transient markers (gpt-image-2)
    'rate_limit_exceeded',
    'server_error',
    '500',
    '502',
    '504',
    'engine overloaded',
  ];
  // Non-transient OpenAI errors: billing / account issues should fail fast.
  const nonTransientPatterns = ['insufficient_quota', 'invalid_api_key', 'account_deactivated'];
  if (nonTransientPatterns.some((p) => message.includes(p))) return false;
  return transientPatterns.some((pattern) => message.includes(pattern));
}

/**
 * Check if this is the last retry attempt for a job.
 */
function isLastAttempt(job: Job): boolean {
  const maxAttempts = job.opts?.attempts || 1;
  return job.attemptsMade + 1 >= maxAttempts;
}

export async function processIllustrationGeneration(job: Job<IllustrationGenerationJobV2>) {
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

  const {
    bookId,
    pageId,
    userId,
    pageNumber,
    artStyle,
    illustrationNotes,
    isTitlePage,
    bookTitle,
    text,
    characterIdentity,
    qcRound,
    qcFeedback,
    language,
  } = job.data;

  console.log(
    `[IllustrationWorker] Starting job ${job.id} for page ${pageNumber} of book ${bookId}`,
  );
  console.log(`  - PageId: ${pageId}`);
  console.log(`  - Is Title Page: ${isTitlePage}`);
  console.log(`  - Art Style: ${artStyle}`);
  console.log(`  - Has Text: ${!!text} (${text?.length || 0} chars)`);
  console.log(`  - Illustration Notes: ${illustrationNotes ? 'Yes' : 'None'}`);
  console.log(
    `  - Character Identity: ${characterIdentity ? `${characterIdentity.characters.length} characters` : 'None'}`,
  );
  console.log(`  - QC Round: ${qcRound || 0}`);
  if (qcFeedback) console.log(`  - QC Feedback: ${qcFeedback.substring(0, 200)}...`);

  try {
    // Validate prerequisites
    if (
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET ||
      !process.env.CLOUDINARY_CLOUD_NAME
    ) {
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

    // QC escalation (ILLUSTRATION_ESCALATION_ENABLED): finalize marks a
    // page's FINAL re-render with a model override. Honor it for this render
    // only; a missing API key for the escalation provider degrades to the
    // default illustrator rather than failing the page.
    const escalation = (job.data as IllustrationGenerationJobV2 & EscalationJobFields).escalation;
    let illustrator = getIllustrator();
    if (escalation?.model) {
      try {
        illustrator = getEscalationIllustrator(escalation.model);
        console.log(
          `[IllustrationWorker] QC escalation for page ${pageNumber}: rendering on ${illustrator.name}/${illustrator.modelId}`,
        );
        logger.info(
          {
            jobId: job.id,
            pageId,
            pageNumber,
            provider: illustrator.name,
            model: illustrator.modelId,
          },
          'Escalated re-render — using escalation model override',
        );
      } catch (escalationError: any) {
        logger.warn(
          {
            jobId: job.id,
            pageId,
            pageNumber,
            model: escalation.model,
            error: escalationError.message,
          },
          'Escalation provider unavailable — falling back to default illustrator',
        );
      }
    }

    logger.info(
      {
        jobId: job.id,
        userId,
        bookId,
        pageId,
        pageNumber,
        parentJobId: job.parent?.id,
        attemptsMade: job.attemptsMade,
      },
      'Processing illustration generation job...',
    );

    const page = await prisma.page.findUnique({
      where: { id: pageId },
      include: {
        book: true,
        asset: true,
      },
    });

    if (!page) {
      throw new Error('Page not found');
    }

    // All pages (including cover) must have story text
    if (!text || text.trim().length === 0) {
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

    // BRIDGE pages: the DB row is the single source of truth. Branching on
    // page.source (never job data) keeps every enqueuer correct for free —
    // the QC requeue path in book-finalize builds child jobs directly and
    // carries no bridge fields, and scoped reillustrate does the same.
    const isBridgePage = page.source === 'BRIDGE';
    const bridgeScene = isBridgePage ? (page.bridgeScene as unknown as BridgeScene | null) : null;

    // AVATAR_STORY (X6d): the whole book is photo-less — every page is a
    // bridge-source row, but there is no adjacent photo to anchor to; the
    // star's character sheet becomes image 1 instead. DB-row keyed
    // (page.book.bookType), same principle as the bridge branch: rows render
    // correctly regardless of flag state at render time.
    const isAvatarBook = page.book.bookType === 'AVATAR_STORY';

    // Anchor the generation to the same 2048 vision-normalized URL that
    // extraction and QC see (also converts HEIC, which the raw asset URL may
    // be, and caps a tiny thumbnailUrl fallback from silently anchoring the
    // page). Three pipeline stages must look at the same version of the photo.
    let rawAnchorUrl = page.asset?.url || page.asset?.thumbnailUrl;

    // A bridge page has no photo of its own — ALWAYS resolve the anchor from
    // the DB at execution time (nearest preceding PHOTO page's asset, or the
    // nearest following one when the authored scene says outfitFrom='next').
    // Any anchor in job data would be at most a stale cache. Avatar books
    // skip this entirely: no photo page exists anywhere in the book.
    if (isBridgePage && !isAvatarBook) {
      const photoPages = await prisma.page.findMany({
        where: { bookId, source: 'PHOTO', assetId: { not: null } },
        orderBy: { pageNumber: 'asc' },
        select: {
          pageNumber: true,
          source: true,
          asset: { select: { url: true, thumbnailUrl: true } },
        },
      });
      const anchor = resolveBridgeAnchor(
        photoPages.map((p) => ({
          pageNumber: p.pageNumber,
          source: p.source,
          assetUrl: p.asset?.url || p.asset?.thumbnailUrl || null,
        })),
        page.pageNumber,
        // The prompt tells the model "Outfits: exactly as worn in the photo
        // (image 1)" — image 1 must therefore be the photo the story model
        // authored the outfits to copy.
        bridgeScene?.outfitFrom ?? 'previous',
      );
      rawAnchorUrl = anchor?.assetUrl ?? undefined;
      console.log(
        `[IllustrationWorker] Bridge page ${pageNumber}: anchoring to photo page ${anchor?.pageNumber ?? 'NONE'}`,
      );
      logger.info(
        { jobId: job.id, pageId, pageNumber, anchorPageNumber: anchor?.pageNumber ?? null },
        'Bridge page — resolved anchor photo from DB',
      );
    }

    const originalImageUrl = rawAnchorUrl
      ? optimizeCloudinaryUrlForVision(convertHeicToJpeg(rawAnchorUrl))
      : undefined;

    if (originalImageUrl) {
      try {
        logger.info(
          { jobId: job.id, pageNumber },
          `Fetching original content image from ${originalImageUrl}`,
        );
        console.log(`[IllustrationWorker] Fetching original image for page ${pageNumber}...`);
        const imageResponse = await fetch(originalImageUrl);
        if (!imageResponse.ok) {
          throw new Error(
            `Failed to fetch content image: ${imageResponse.status} ${imageResponse.statusText}`,
          );
        }
        const contentTypeHeader = imageResponse.headers.get('content-type');
        contentImageMimeType = contentTypeHeader?.startsWith('image/')
          ? contentTypeHeader
          : originalImageUrl.endsWith('.png')
            ? 'image/png'
            : 'image/jpeg';

        const imageArrayBuffer = await imageResponse.arrayBuffer();
        contentImageBuffer = Buffer.from(imageArrayBuffer);
        logger.info(
          { jobId: job.id, pageNumber },
          `Fetched content image (${contentImageMimeType}).`,
        );
      } catch (fetchError: any) {
        logger.error(
          { jobId: job.id, pageId, pageNumber, error: fetchError.message },
          'Failed to fetch content image.',
        );
        throw fetchError;
      }
    } else if (!isAvatarBook) {
      logger.error({ jobId: job.id, pageId, pageNumber }, 'Original content image URL is missing.');
      throw new Error('Missing originalImageUrl for illustration generation.');
    }

    if ((!contentImageBuffer || !contentImageMimeType) && !isAvatarBook) {
      logger.error(
        { jobId: job.id, pageId, pageNumber },
        'Content image buffer or mime type missing.',
      );
      throw new Error('Content image buffer/mime type missing.');
    }

    const styleKey = artStyle as StyleKey;

    // Defensive check: Ensure STYLE_LIBRARY is loaded (prevent race condition on module import)
    if (!STYLE_LIBRARY || Object.keys(STYLE_LIBRARY).length === 0) {
      logger.error(
        { jobId: job.id, pageId, pageNumber },
        'STYLE_LIBRARY not loaded - module import race condition detected',
      );
      throw new Error('STYLE_LIBRARY not loaded - please retry');
    }

    const styleData = STYLE_LIBRARY[styleKey];
    if (!styleData) {
      logger.error(
        {
          jobId: job.id,
          pageId,
          pageNumber,
          styleKey,
          availableStyles: Object.keys(STYLE_LIBRARY),
        },
        'Invalid style key - not found in STYLE_LIBRARY',
      );
      throw new Error(
        `Invalid style key: ${styleKey}. Available styles: ${Object.keys(STYLE_LIBRARY).join(', ')}`,
      );
    }

    // Character sheets (CHARACTER_SHEETS_ENABLED): validated 2x2 turnaround
    // grids snapshotted into job data by the extraction/finalize workers.
    // Fetch failures degrade gracefully — a page render must never fail
    // because a reference sheet went missing.
    const sheetRefs: IllustrationImageInput[] = [];
    // Metadata for each SUCCESSFULLY-fetched sheet, index-aligned with
    // sheetRefs — the A4 name map must reflect only the sheets actually sent.
    const fetchedSheetMeta: { characterId: string; name: string | null }[] = [];
    // Book sheets ride CHARACTER_SHEETS_ENABLED; account-avatar sheets ride
    // AVATARS_ENABLED — either gate admits the snapshot the flow built.
    // AVATAR_STORY books admit sheets unconditionally: they are the only
    // identity anchor the render has.
    if (
      (characterSheetsEnabled() || process.env.AVATARS_ENABLED === 'true' || isAvatarBook) &&
      job.data.characterSheets?.length
    ) {
      // AVATAR_STORY: the FIRST fetched sheet becomes image 1 (the render's
      // content anchor), so the order must be deterministic — star first,
      // then roster (pick) order; without a star (adult-only cast) roster
      // order alone decides. The snapshot order comes from an unordered
      // findMany and must never pick the anchor.
      let sheetSources = job.data.characterSheets;
      if (isAvatarBook && sheetSources.length > 1) {
        const starId =
          characterIdentity?.characters?.find((c) => c.role?.startsWith('main'))?.characterId ??
          null;
        // A6: interior avatar pages ship only the scene's cast (+ the star
        // floor, cap 4) to shrink the fusion/duplication surface. The title
        // page is EXEMPT — it feeds the cover, which keeps every sheet
        // (see the cover call below); filtering it would starve that binding.
        sheetSources = isTitlePage
          ? orderCharacterSheets(sheetSources, starId)
          : selectSceneSheets(sheetSources, {
              charactersPresent: bridgeScene ? bridgeScene.charactersPresent : null,
              starCharacterId: starId,
            });
      }
      for (const sheet of sheetSources) {
        try {
          sheetRefs.push(await fetchImageInput(optimizeCloudinaryUrlForVision(sheet.url)));
          fetchedSheetMeta.push({ characterId: sheet.characterId, name: sheet.name });
        } catch (sheetFetchError: any) {
          logger.warn(
            {
              jobId: job.id,
              pageNumber,
              characterId: sheet.characterId,
              error: sheetFetchError.message,
            },
            'Failed to fetch character sheet — continuing without it',
          );
        }
      }
      console.log(
        `[IllustrationWorker] Fetched ${sheetRefs.length} character sheet(s) for page ${pageNumber}`,
      );
    }

    // All pages (including cover) use standard style references for the story illustration.
    // Cover pages get a separate cover-style illustration generated afterwards.
    // With character sheets in the stack, trim the style exemplars to 2
    // (kawaii ships 4) to keep the reference budget for identity.
    const baseStyleReferenceUrls: string[] =
      sheetRefs.length > 0
        ? [...styleData.referenceImageUrls].slice(0, 2)
        : [...styleData.referenceImageUrls];
    // X12-D style-ref diet (ILLUSTRATION_STYLE_REFS_MAX, default unset =
    // current behavior). 0 deliberately sends no style-ref images — the style
    // bible text carries the style. Applied AFTER the base trim; the
    // missing-URL diagnostic below checks the UNCAPPED list so genuinely
    // broken style data is still caught in diet mode. Provider-gated: the diet
    // is validated for OpenAI only, so a rollback to gemini ignores the env
    // var — rollback stays a one-variable change.
    const styleRefsCap = styleRefsCapForProvider(illustrator.name, process.env);
    const styleReferenceUrls: string[] = capStyleRefs(baseStyleReferenceUrls, styleRefsCap);

    // ============================================================================
    // DIAGNOSTIC: Database-persisted logging to survive process crashes
    // ============================================================================
    // CRITICAL: Console logs are being lost due to process crashes/termination.
    // Write diagnostic data to database FIRST, then log to console.
    // Checks the UNCAPPED list: an empty CAPPED list under the diet is
    // deliberate, an empty BASE list is broken style data.
    if (!baseStyleReferenceUrls || baseStyleReferenceUrls.length === 0) {
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
      console.error(
        '[DIAGNOSTIC] Wrote failure details to WorkerDiagnostic table - query with MCP',
      );

      // Force log flush with small delay to ensure Railway captures output
      await new Promise((resolve) => setTimeout(resolve, 500));

      throw new Error(
        `Missing referenceImageUrls for style: ${styleKey}. Attempt ${job.attemptsMade + 1}/${job.opts?.attempts || 'unknown'}`,
      );
    }

    // Fetch all style reference images
    const styleReferenceBuffers: Array<{ buffer: Buffer; mimeType: string }> = [];

    for (const styleRefUrl of styleReferenceUrls) {
      try {
        logger.info(
          { jobId: job.id, pageNumber },
          `Fetching style reference image from ${styleRefUrl}`,
        );
        const styleResponse = await fetch(styleRefUrl);
        if (!styleResponse.ok) {
          throw new Error(
            `Failed to fetch style image: ${styleResponse.status} ${styleResponse.statusText}`,
          );
        }
        const styleContentTypeHeader = styleResponse.headers.get('content-type');
        const mimeType = styleContentTypeHeader?.startsWith('image/')
          ? styleContentTypeHeader
          : styleRefUrl.endsWith('.png')
            ? 'image/png'
            : 'image/jpeg';

        const styleArrayBuffer = await styleResponse.arrayBuffer();
        styleReferenceBuffers.push({
          buffer: Buffer.from(styleArrayBuffer),
          mimeType,
        });
        logger.info({ jobId: job.id, pageNumber }, `Fetched style reference image (${mimeType}).`);
      } catch (fetchError: any) {
        logger.error(
          { jobId: job.id, pageId, pageNumber, styleKey, error: fetchError.message },
          'Failed to fetch style reference image.',
        );
        throw fetchError;
      }
    }

    // Zero fetched buffers is only an error when the diet didn't deliberately
    // zero the list (ILLUSTRATION_STYLE_REFS_MAX=0 sends none by design).
    if (styleReferenceBuffers.length === 0 && styleRefsCap !== 0) {
      logger.error(
        { jobId: job.id, pageId, pageNumber },
        'No style reference images fetched successfully.',
      );
      throw new Error('No style reference images fetched.');
    }

    console.log(
      `[IllustrationWorker] Fetched ${styleReferenceBuffers.length} style reference image(s) for page ${pageNumber}`,
    );

    // AVATAR_STORY: no photo exists — the FIRST character sheet becomes the
    // content image (image 1) and the rest stay reference sheets. A page with
    // zero sheets cannot render on-model; fail it clearly (page → FAILED,
    // book → PARTIAL) rather than inventing faces.
    let sheetAnchored = false;
    let contentInput: IllustrationImageInput;
    if (contentImageBuffer && contentImageMimeType) {
      contentInput = { buffer: contentImageBuffer, mimeType: contentImageMimeType };
    } else if (isAvatarBook && sheetRefs.length > 0) {
      contentInput = sheetRefs.shift()!;
      sheetAnchored = true;
      console.log(
        `[IllustrationWorker] Avatar-story page ${pageNumber}: anchoring render to the star's character sheet`,
      );
    } else {
      logger.error(
        { jobId: job.id, pageId, pageNumber, isAvatarBook },
        'No content anchor available for render.',
      );
      throw new Error(
        isAvatarBook
          ? 'Avatar-story page has no character sheet to anchor the render'
          : 'Content image buffer/mime type missing.',
      );
    }
    // Truthful sheet attribution: the anchor sheet counts even after shift().
    const renderHadSheet = sheetRefs.length > 0 || sheetAnchored;

    // A4 name↔sheet map: bind each sheet ACTUALLY SENT (anchor first, then the
    // remaining refs) to its named character + a compact species phrase, so
    // the model never guesses which unnamed grid is whom. Sheet-anchored
    // (avatar) renders only — image 1 is a photo on every other path.
    // fetchedSheetMeta is still in full sent order (the shift() above popped
    // sheetRefs, not this list), so its order matches image 1..N.
    const sheetRoster = sheetAnchored
      ? fetchedSheetMeta.map((meta) => {
          const rosterChar = characterIdentity?.characters?.find(
            (c) => c.characterId === meta.characterId,
          );
          return {
            name: meta.name || rosterChar?.name || meta.characterId,
            species: speciesLineFor(rosterChar, kindFromRole(rosterChar?.role)),
          };
        })
      : undefined;

    // For the primary illustration, always use story-style prompt (isTitlePage: false).
    // Cover pages get a separate cover-style illustration generated afterwards.
    const promptInput: IllustrationPromptOptions = {
      style: styleKey,
      pageText: text,
      bookTitle: bookTitle,
      isTitlePage: false,
      illustrationNotes: illustrationNotes,
      language: language || 'en',
      referenceImageCount: styleReferenceBuffers.length,
      characterIdentity: characterIdentity || null,
      pageNumber: pageNumber,
      qcFeedback: qcFeedback || null,
      characterSheetCount: sheetRefs.length,
      // Bridge pages: re-roles image 1 (anchor photo, not this page's
      // scene) and filters identity by scene.charactersPresent.
      // Avatar-story pages: re-roles image 1 as a character sheet and
      // composes the scene from the story model (or the page text).
      bridgeScene,
      ...(sheetAnchored ? { contentAnchor: 'sheet' as const } : {}),
      ...(sheetRoster ? { sheetRoster } : {}),
      // Neutralize roster names iff the provider that renders this page is
      // OpenAI. `illustrator` already reflects the QC escalation override, so
      // an OpenAI escalation neutralizes and a Gemini escalation does not. The
      // D5 Gemini content-policy fallback REUSES this prompt verbatim (it never
      // rebuilds mid-flight); a neutral prompt is valid on Gemini — just not
      // required — so reuse is correct. No-op on the photo path / when off.
      neutralizeCharacterNames: shouldNeutralizeNames(illustrator.name),
      // TOYS_COME_ALIVE_ENABLED (X13 Track T): on the sheet-anchored path, adds
      // the living-companion render directive when a toy is in the page's cast.
      // The directive itself is gated internally to contentAnchor 'sheet' and
      // toy presence, so a flag-on non-toy page stays byte-identical.
      toysComeAlive: toysComeAliveEnabled(),
      // STORY_ILLUS_MOOD_ENABLED (STORY QUALITY V2): photo-path interiors get
      // the story model's per-page mood cue as a bounded lighting/expression
      // directive. Read from the DB row (always fresh); flag-off → absent →
      // prompt byte-identical.
      ...(storyIllusMoodEnabled() && !isBridgePage && !isAvatarBook && page.illustrationMood
        ? { illustrationMood: page.illustrationMood }
        : {}),
    };

    logger.info(
      { jobId: job.id, pageId, promptInput },
      'Constructed promptInput for createIllustrationPrompt',
    );
    const textPrompt = createIllustrationPrompt(promptInput);
    logger.info(
      { jobId: job.id, pageId, pageNumber, promptLength: textPrompt.length },
      'Generated illustration prompt.',
    );

    console.log(`[IllustrationWorker] Generated prompt for page ${pageNumber}:`);
    console.log(`  - Prompt length: ${textPrompt.length} chars`);
    console.log(`  - First 100 chars: ${textPrompt.substring(0, 100)}...`);

    logger.info(
      { jobId: job.id, pageId, pageNumber, refCount: styleReferenceBuffers.length },
      'Prepared images for illustration provider.',
    );

    let generatedImageBase64: string | null = null;
    let moderationBlocked = false;
    let moderationReasonText: string | null = null;

    // The provider whose render is actually stored — swapped to Gemini only
    // when the dark content-policy fallback succeeds (attribution stamps below
    // must reflect who drew the page, not who was asked first).
    let renderProvider: IllustrationProvider = illustrator;
    // At most ONE Gemini fallback per page per job run.
    let geminiFallbackAttempted = false;

    const MAX_CONTENT_POLICY_RETRIES = 2;
    for (
      let contentPolicyAttempt = 0;
      contentPolicyAttempt <= MAX_CONTENT_POLICY_RETRIES;
      contentPolicyAttempt++
    ) {
      // Reset for each attempt
      moderationBlocked = false;
      moderationReasonText = null;
      generatedImageBase64 = null;

      if (contentPolicyAttempt > 0) {
        const delayMs = 3000 + Math.random() * 2000; // 3-5s jittered delay
        console.log(
          `[IllustrationWorker] Content policy retry ${contentPolicyAttempt}/${MAX_CONTENT_POLICY_RETRIES} for page ${pageNumber}, waiting ${Math.round(delayMs)}ms...`,
        );
        logger.info(
          {
            jobId: job.id,
            pageNumber,
            attempt: contentPolicyAttempt + 1,
            maxAttempts: MAX_CONTENT_POLICY_RETRIES + 1,
          },
          'Retrying after content policy block...',
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        logger.info(
          { jobId: job.id, pageId, pageNumber, provider: illustrator.name },
          'Calling illustration provider...',
        );
        console.log(
          `[IllustrationWorker] Calling ${illustrator.name} for page ${pageNumber} with ${styleReferenceBuffers.length} style ref(s)...`,
        );

        const illustrationInput: IllustrationInput = {
          contentImage: contentInput,
          // Ordered between photo and style refs; the prompt's role line
          // (characterSheetCount) names each image by this position.
          ...(sheetRefs.length > 0 ? { characterRefs: sheetRefs } : {}),
          styleRefs: styleReferenceBuffers,
          prompt: textPrompt,
        };

        const result = await illustrator.generate(illustrationInput);

        logger.info(
          { jobId: job.id, pageId, pageNumber, provider: illustrator.name },
          'Received response from illustration provider.',
        );
        console.log(
          `[IllustrationWorker] ${illustrator.name} response received for page ${pageNumber}`,
        );

        if (result.imageBase64) {
          generatedImageBase64 = result.imageBase64;
          logger.info({ jobId: job.id, pageId, pageNumber }, 'Extracted generated image data.');
        } else {
          moderationBlocked = true;
          moderationReasonText = result.blockedReason ?? 'Image generation returned no data.';
          logger.warn(
            {
              jobId: job.id,
              pageId,
              pageNumber,
              attempt: contentPolicyAttempt + 1,
              maxAttempts: MAX_CONTENT_POLICY_RETRIES + 1,
              reason: moderationReasonText,
            },
            'Illustration provider reported content block or no image data.',
          );

          // Dark per-page content-policy fallback
          // (ILLUSTRATION_OPENAI_FALLBACK_GEMINI): on an OpenAI block, make ONE
          // Gemini re-attempt on the SAME inputs before the retry/FLAGGED path.
          // Returns null (no-op) when the flag is off or the provider is not
          // OpenAI, so default behavior is byte-identical. At most one attempt
          // per page per job run.
          if (!geminiFallbackAttempted) {
            geminiFallbackAttempted = true;
            const fallback = await maybeGeminiFallback({
              providerName: illustrator.name,
              blockedReason: result.blockedReason,
              input: illustrationInput,
              env: process.env,
              makeGemini: getGeminiFallbackIllustrator,
              logger,
              logContext: { jobId: job.id, pageId, pageNumber },
            });
            if (fallback) {
              generatedImageBase64 = fallback.imageBase64;
              renderProvider = fallback.provider;
              moderationBlocked = false;
              moderationReasonText = null;
            }
          }
        }
      } catch (apiError: any) {
        // Extract detailed error information from illustration provider response
        const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
        const errorCode = apiError?.code || apiError?.response?.status;
        const errorDetails = apiError?.response?.data || apiError?.details;

        // Check for specific error types
        const isSafetyBlock =
          errorMessage.toLowerCase().includes('safety') ||
          errorMessage.toLowerCase().includes('blocked') ||
          errorMessage.toLowerCase().includes('content policy');
        const isCopyrightIssue =
          errorMessage.toLowerCase().includes('copyright') ||
          errorMessage.toLowerCase().includes('proprietary') ||
          errorMessage.toLowerCase().includes('trademark');
        const isContentPolicyBlock = isSafetyBlock || isCopyrightIssue;

        logger.error(
          {
            jobId: job.id,
            pageId,
            pageNumber,
            error: errorMessage,
            errorCode,
            errorDetails,
            isSafetyBlock,
            isCopyrightIssue,
            isContentPolicyBlock,
            fullError: JSON.stringify(apiError, null, 2),
          },
          'Error calling illustration provider API.',
        );

        console.error(`[IllustrationWorker] ${illustrator.name} API error for page ${pageNumber}:`);
        console.error(`  - Error: ${errorMessage}`);
        console.error(`  - Error Code: ${errorCode || 'N/A'}`);
        console.error(`  - Is Content Policy Block: ${isContentPolicyBlock}`);
        if (isSafetyBlock) console.error(`  - Type: SAFETY/CONTENT POLICY BLOCK`);
        if (isCopyrightIssue) console.error(`  - Type: COPYRIGHT/PROPRIETARY ISSUE`);
        if (errorDetails) console.error(`  - Details: ${JSON.stringify(errorDetails)}`);

        // Content policy violations - retry up to MAX_CONTENT_POLICY_RETRIES times before giving up
        if (isContentPolicyBlock) {
          moderationBlocked = true;
          moderationReasonText = `${errorMessage}${errorCode ? ` (Code: ${errorCode})` : ''}${isSafetyBlock ? ' [SAFETY]' : ''}${isCopyrightIssue ? ' [COPYRIGHT]' : ''}`;
          if (contentPolicyAttempt < MAX_CONTENT_POLICY_RETRIES) {
            console.log(
              `[IllustrationWorker] Content policy block on attempt ${contentPolicyAttempt + 1}/${MAX_CONTENT_POLICY_RETRIES + 1} for page ${pageNumber}, will retry...`,
            );
            continue; // retry loop
          }
          console.log(
            `[IllustrationWorker] Content policy block after ${MAX_CONTENT_POLICY_RETRIES + 1} attempts - marking as FLAGGED`,
          );
          // Don't throw - let job complete successfully with FLAGGED status
        } else {
          // Other API errors (possibly transient) - re-throw to trigger outer catch block retry logic
          console.log(
            `[IllustrationWorker] API error (possibly transient) - re-throwing for retry logic`,
          );
          throw apiError;
        }
      }

      // If we got image data, break out of retry loop
      if (generatedImageBase64 && !moderationBlocked) {
        break;
      }

      // If no image data but not from an API error (response had no image), handle retry
      if (moderationBlocked && contentPolicyAttempt < MAX_CONTENT_POLICY_RETRIES) {
        console.log(
          `[IllustrationWorker] Content policy block on attempt ${contentPolicyAttempt + 1}/${MAX_CONTENT_POLICY_RETRIES + 1} for page ${pageNumber}, will retry...`,
        );
        continue;
      }

      // All retries exhausted or success — break out
      break;
    } // end content policy retry loop

    let finalImageUrl: string | undefined = undefined;
    // Hoisted out of the upload try-block: the cover generation below reuses
    // the approved interior render as a reference image.
    let interiorRenderBuffer: Buffer | null = null;
    if (generatedImageBase64 && !moderationBlocked) {
      try {
        logger.info(
          { jobId: job.id, pageId, pageNumber },
          'Decoding and uploading generated image to Cloudinary...',
        );
        let generatedImageBuffer = Buffer.from(generatedImageBase64, 'base64');

        // Upscale from 2048×2048 to Lulu print size (2625×2625) for 300 DPI at 8.75"
        // This ensures 300 DPI quality for 8.75" × 8.75" print with bleed
        try {
          logger.info(
            { jobId: job.id, pageId, pageNumber },
            'Upscaling image for print quality (2048 → 2625px)...',
          );
          console.log(`[IllustrationWorker] Upscaling page ${pageNumber} to 2625×2625 for print`);
          generatedImageBuffer = await upscaleForPrint(generatedImageBuffer);
          interiorRenderBuffer = generatedImageBuffer;
          logger.info({ jobId: job.id, pageId, pageNumber }, 'Image upscaled successfully.');
        } catch (upscaleError: any) {
          const errorMessage = `Image upscaling failed: ${upscaleError.message}`;
          logger.error(
            {
              jobId: job.id,
              pageId,
              pageNumber,
              error: upscaleError.message,
              stack: upscaleError.stack,
            },
            errorMessage,
          );
          console.error(
            `[IllustrationWorker] Upscaling failed for page ${pageNumber}: ${upscaleError.message}`,
          );
          throw new Error(errorMessage);
        }

        // Logo overlay is now only applied to the separate cover illustration (generated below)

        const uploadResult = await new Promise<any>((resolve, reject) => {
          cloudinary.uploader
            .upload_stream(
              {
                folder: `storywink/${bookId}/generated`,
                public_id: `page_${pageNumber}`,
                overwrite: true,
                tags: [
                  `book:${bookId}`,
                  `page:${pageId}`,
                  `pageNum:${pageNumber}`,
                  `style:${styleKey}`,
                ],
                resource_type: 'image',
              },
              (error, result) => {
                if (error) {
                  reject(error);
                } else {
                  resolve(result);
                }
              },
            )
            .end(generatedImageBuffer);
        });

        if (!uploadResult?.secure_url) {
          throw new Error('Cloudinary upload did not return a secure URL.');
        }
        finalImageUrl = uploadResult.secure_url;
        logger.info(
          { jobId: job.id, pageId, pageNumber, cloudinaryUrl: finalImageUrl },
          'Successfully uploaded generated image to Cloudinary',
        );
        console.log(`[IllustrationWorker] Image uploaded for page ${pageNumber}: ${finalImageUrl}`);
      } catch (uploadError: any) {
        logger.error(
          { jobId: job.id, pageId, pageNumber, error: uploadError.message },
          'Failed to upload generated image to Cloudinary.',
        );
        moderationBlocked = true;
        moderationReasonText =
          moderationReasonText || `Cloudinary upload failed: ${uploadError.message}`;
      }
    }

    try {
      await prisma.page.update({
        where: { id: pageId },
        data: {
          // Overwrite the image only on a successful render+upload. On a
          // block/failure any previous image (e.g. the round-1 render a
          // QC re-render is replacing) stays in place — an imperfect
          // page beats an empty one.
          ...(!moderationBlocked && finalImageUrl
            ? {
                generatedImageUrl: finalImageUrl,
                // Render-time attribution stamps: finalize persists QC
                // rows from these; it cannot infer provider/model.
                // renderProvider reflects the Gemini fallback when it drew the
                // page, otherwise the primary illustrator.
                lastRenderProvider: renderProvider.name,
                lastRenderModel: renderProvider.modelId,
                // sheetRefs is what this render actually conditioned
                // on (truthful even when a sheet fetch degraded), so
                // QC ground truth can be derived per render, not from
                // Book.characterReferences at finalize time. The
                // avatar-story anchor sheet counts too.
                lastRenderHadSheet: renderHadSheet,
              }
            : {}),
          moderationStatus: moderationBlocked ? 'FLAGGED' : 'OK',
          // Blocked renders never reach QC rows, so attribution for them
          // lives in the moderation reason itself.
          moderationReason:
            moderationBlocked && moderationReasonText
              ? `[${illustrator.name}/${illustrator.modelId}] ${moderationReasonText}`
              : moderationReasonText,
        },
      });
      logger.info(
        {
          jobId: job.id,
          pageId,
          pageNumber,
          status: moderationBlocked ? 'FLAGGED' : 'OK',
          reason: moderationReasonText,
        },
        'Page status updated.',
      );

      console.log(`[IllustrationWorker] Page ${pageNumber} completed:`);
      console.log(`  - Status: ${moderationBlocked ? 'FLAGGED' : 'OK'}`);
      console.log(`  - Generated Image: ${finalImageUrl ? 'Success' : 'Failed'}`);
      if (moderationReasonText) {
        console.log(`  - Reason: ${moderationReasonText}`);
      }
    } catch (dbError: any) {
      logger.error(
        { jobId: job.id, pageId, pageNumber, error: dbError.message },
        'Failed to update page status in database.',
      );
      throw dbError;
    }

    // Generate separate COVER illustration for the cover page (with cover prompt + logo)
    if (isTitlePage && !moderationBlocked && finalImageUrl) {
      console.log(
        `[IllustrationWorker] Generating separate cover illustration for title page ${pageNumber}...`,
      );
      try {
        // Cover binding (CHARACTER_SHEETS_ENABLED): the cover call receives
        // the character sheet(s) plus the approved interior title-page render
        // as references, so the two renders of the same photo stop diverging.
        const interiorRenderRef =
          (characterSheetsEnabled() || isAvatarBook) && interiorRenderBuffer
            ? await resizeForReference(interiorRenderBuffer)
            : null;

        // AVATAR_STORY covers: there is no title photo — the approved
        // interior render of page 1 anchors the cover repaint, and ALL cast
        // sheets (including the anchor sheet the interior render used) ride
        // as identity references.
        const avatarCoverAnchor = isAvatarBook ? (interiorRenderRef ?? contentInput) : null;

        const coverOutcome = await generateAndStoreCover({
          bookId,
          styleKey,
          bookTitle: bookTitle ?? null,
          pageText: text,
          illustrationNotes: illustrationNotes ?? null,
          language: language || 'en',
          characterIdentity: characterIdentity || null,
          pageNumber,
          contentImage: avatarCoverAnchor ?? {
            buffer: contentImageBuffer!,
            mimeType: contentImageMimeType!,
          },
          characterSheetRefs: isAvatarBook
            ? [...(sheetAnchored ? [contentInput] : []), ...sheetRefs]
            : sheetRefs,
          interiorRenderRef: isAvatarBook ? null : interiorRenderRef,
          ...(isAvatarBook ? { contentAnchor: 'interior' as const } : {}),
          // QC feedback targets the interior title-page render, not the cover
          // (a different image the QC pass never saw) — never inherit it here.
          // Cover-targeted feedback only flows through finalize's regen round.
          qcFeedback: null,
          logger,
        });

        if ('coverUrl' in coverOutcome) {
          console.log(
            `[IllustrationWorker] Cover illustration generated and stored: ${coverOutcome.coverUrl}`,
          );
        }
      } catch (coverError: any) {
        // Cover illustration failure is non-fatal -- the story illustration is already saved
        logger.error(
          { jobId: job.id, bookId, pageNumber, error: coverError.message },
          'Cover illustration generation failed (non-fatal)',
        );
        console.error(
          `[IllustrationWorker] Cover illustration failed for page ${pageNumber}: ${coverError.message}`,
        );
      }
    }

    // The book-finalize worker will handle status updates
    console.log(`[IllustrationWorker] Job ${job.id} completed successfully for page ${pageNumber}`);

    return {
      success: true,
      imageUrl: finalImageUrl,
      pageNumber,
      moderationStatus: moderationBlocked ? 'FLAGGED' : 'OK',
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
      failureStage:
        errorMessage.includes('text overlay') || errorMessage.includes('Text overlay')
          ? 'text_overlay'
          : errorMessage.includes('Gemini') ||
              errorMessage.includes('Google') ||
              errorMessage.includes('OpenAI') ||
              errorMessage.includes('gpt-image')
            ? 'ai_generation'
            : errorMessage.includes('Cloudinary')
              ? 'image_upload'
              : errorMessage.includes('fetch')
                ? 'image_fetch'
                : errorMessage.includes('database')
                  ? 'database_update'
                  : 'unknown',
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
      console.log(
        `[IllustrationWorker] Transient error detected - BullMQ will retry automatically`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100)); // Flush logs
      throw error;
    }

    // PERMANENT ERROR or LAST ATTEMPT: Mark page as FAILED
    console.error(
      `[IllustrationWorker] Marking page ${pageNumber} as FAILED (permanent error or final attempt)`,
    );

    try {
      await prisma.page.update({
        where: { id: pageId },
        data: {
          moderationStatus: 'FAILED',
          moderationReason: `Job failed (${errorContext.failureStage}): ${errorMessage}`.slice(
            0,
            1000,
          ),
        },
      });
      console.error(`[IllustrationWorker] Page ${pageNumber} marked as FAILED in database`);
    } catch (updateError: any) {
      logger.error(
        { jobId: job.id, bookId, error: updateError.message },
        'Failed to update page status to FAILED after job error.',
      );
      console.error(
        `[IllustrationWorker] WARNING: Could not mark page ${pageNumber} as failed in database: ${updateError.message}`,
      );
    }

    // Force log flush delay before throwing to ensure Railway captures logs
    await new Promise((resolve) => setTimeout(resolve, 500));

    throw error;
  }
}
