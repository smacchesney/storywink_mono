import { Router } from "express";
import { requireAuth } from "@clerk/express";
import { Queue } from "bullmq";
import {
  generateStorySchema,
  generateIllustrationSchema,
  QUEUE_NAMES,
  isTitlePage,
} from "@storywink/shared";
import prisma from "../database/index.js";
import Redis from "ioredis";
import {
  ensureDbUser,
  AuthenticatedRequest,
} from "../middleware/ensureDbUser.js";
import { flowProducer } from "../lib/queue/index.js";

// Create Redis connection
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// Create queues
const storyQueue = new Queue(QUEUE_NAMES.STORY_GENERATION, {
  connection: redis,
});

// Note: illustrationQueue is now handled by FlowProducer
// Individual queue instances are created automatically by FlowProducer

// Job data interfaces
interface IllustrationGenerationJobData {
  userId: string;
  bookId: string;
  pageId: string;
  pageNumber: number;
  text: string | null;
  artStyle: string | null | undefined;
  bookTitle: string | null | undefined;
  isTitlePage: boolean;
  illustrationNotes: string | null | undefined;
  isWinkifyEnabled: boolean;
}

interface BookFinalizeJobData {
  bookId: string;
  userId: string;
}

export const generateRouter = Router();

// Apply auth middleware to all routes
generateRouter.use(requireAuth());
generateRouter.use(ensureDbUser);

// POST /api/generate/story - Generate story for a book
generateRouter.post("/story", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;
    const { bookId } = generateStorySchema.parse(req.body);

    // Verify book ownership and get book data
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
      include: {
        pages: {
          include: {
            asset: true,
          },
          orderBy: { pageNumber: "asc" },
        },
      },
    });

    if (!book) {
      res.status(404).json({
        success: false,
        error: "Book not found",
      });
      return;
    }

    // Update book status
    await prisma.book.update({
      where: { id: bookId },
      data: { status: "GENERATING" },
    });

    // Add to story generation queue
    await storyQueue.add("generate-story", {
      bookId,
      userId,
      assets: book.pages.map((p) => p.asset).filter(Boolean),
      bookDetails: {
        title: book.title,
        childName: book.childName,
        artStyle: book.artStyle,
        tone: book.tone,
        theme: book.theme,
        isWinkifyEnabled: book.isWinkifyEnabled,
      },
    });

    res.json({
      success: true,
      message: "Story generation started",
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/generate/illustrations - Generate illustrations for pages
generateRouter.post(
  "/illustrations",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.dbUser!.id;
      const { bookId, pageIds } = generateIllustrationSchema.parse(req.body);

      console.log(`[Express API] Starting illustration generation for book ${bookId}`);
      console.log(`  - User ID: ${userId}`);
      console.log(`  - Specific Page IDs: ${pageIds ? pageIds.join(', ') : 'All pages'}`);

      // Verify book ownership and get detailed book data
      const book = await prisma.book.findFirst({
        where: { id: bookId, userId },
        include: {
          pages: {
            include: {
              asset: true,
            },
            orderBy: { pageNumber: 'asc' },
          },
        },
      });

      if (!book) {
        console.error(`[Express API] Book not found: ${bookId}`);
        res.status(404).json({
          success: false,
          error: "Book not found",
        });
        return;
      }

      console.log(`[Express API] Book found: ${book.title}`);
      console.log(`  - Total Pages: ${book.pages.length}`);
      console.log(`  - Current Status: ${book.status}`);
      console.log(`  - Art Style: ${book.artStyle}`);
      console.log(`  - Winkify: ${book.isWinkifyEnabled}`);
      console.log(`  - Cover Asset ID: ${book.coverAssetId}`);

      // Update book status
      await prisma.book.update({
        where: { id: bookId },
        data: { status: "ILLUSTRATING" },
      });

      // Improved filtering logic with diagnostic logging
      let pagesToIllustrate;
      if (pageIds) {
        // Specific pages requested
        pagesToIllustrate = book.pages.filter((p) => pageIds.includes(p.id));
        console.log(`[Express API] Filtering by specific page IDs: ${pageIds.join(', ')}`);
      } else {
        // Process all pages that need illustrations
        // Include title pages (they don't need text) and story pages with text
        // Use page.isTitlePage field for consistency
        pagesToIllustrate = book.pages.filter((p) => {
          const isTitle = p.isTitlePage;
          const hasText = !!(p.text && p.text.trim());
          const hasExistingImage = !!p.generatedImageUrl;

          // Include if: (title page OR has text) AND no existing image
          const shouldInclude = (isTitle || hasText) && !hasExistingImage;

          console.log(`[Express API] Page ${p.pageNumber} analysis:`);
          console.log(`    - Is Title Page: ${isTitle} (using page.isTitlePage field)`);
          console.log(`    - Has Text: ${hasText} (${p.text?.length || 0} chars)`);
          console.log(`    - Has Existing Image: ${hasExistingImage}`);
          console.log(`    - Will Process: ${shouldInclude}`);

          return shouldInclude;
        });
      }

      console.log(`[Express API] Pages to illustrate: ${pagesToIllustrate.length}/${book.pages.length}`);
      
      if (pagesToIllustrate.length === 0) {
        console.warn(`[Express API] No pages to illustrate for book ${bookId}`);
        res.json({
          success: true,
          message: "No pages require illustration generation",
          processed: 0,
        });
        return;
      }

      // Create child job definitions for each page (matching Next.js API pattern)
      const pageChildren = pagesToIllustrate.map((page) => {
        // Use page.isTitlePage field for consistency
        const isActualTitlePage = page.isTitlePage;

        const illustrationJobData: IllustrationGenerationJobData = {
          userId,
          bookId,
          pageId: page.id,
          pageNumber: page.pageNumber,
          text: page.text,
          artStyle: book.artStyle,
          bookTitle: book.title,
          isWinkifyEnabled: book.isWinkifyEnabled || false,
          isTitlePage: isActualTitlePage,
          illustrationNotes: page.illustrationNotes,
        };

        const jobName = `generate-illustration-${bookId}-p${page.pageNumber}`;
        console.log(`[Express API] Creating job: ${jobName}`);
        console.log(`    - Page ID: ${page.id}`);
        console.log(`    - Is Title: ${isActualTitlePage} (using page.isTitlePage field)`);
        console.log(`    - Has Text: ${!!page.text} (${page.text?.length || 0} chars)`);
        
        return {
          name: jobName,
          queueName: QUEUE_NAMES.ILLUSTRATION_GENERATION,
          data: illustrationJobData,
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 },
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 5000 },
            failParentOnFailure: false,
            removeDependencyOnFailure: true,
          },
        };
      });

      // Create parent finalize job
      const finalizeJobData: BookFinalizeJobData = {
        bookId,
        userId,
      };

      console.log(`[Express API] Creating FlowProducer job:`);
      console.log(`  - Parent: finalize-book-${bookId}`);
      console.log(`  - Children: ${pageChildren.length} illustration jobs`);

      // Add the flow (parent job + children) atomically
      const flow = await flowProducer.add({
        name: `finalize-book-${bookId}`,
        queueName: QUEUE_NAMES.BOOK_FINALIZE,
        data: finalizeJobData,
        opts: {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
        children: pageChildren,
      });

      console.log(`[Express API] Flow created successfully:`);
      console.log(`  - Flow Job ID: ${flow.job.id}`);
      console.log(`  - Parent Job: ${flow.job.name}`);
      console.log(`  - Child Jobs: ${flow.children?.length || 0}`);

      res.json({
        success: true,
        message: `Illustration generation started for ${pagesToIllustrate.length} pages`,
        processed: pagesToIllustrate.length,
        flowJobId: flow.job.id,
      });
    } catch (error) {
      console.error(`[Express API] Error in illustration generation:`, error);
      next(error);
    }
  },
);
