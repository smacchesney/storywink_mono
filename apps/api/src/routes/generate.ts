import { Router } from "express";
import { requireAuth } from "@clerk/express";
import { Queue } from "bullmq";
import {
  generateStorySchema,
  generateIllustrationSchema,
  QUEUE_NAMES,
} from "@storywink/shared";
import prisma from "../database/index.js";
import Redis from "ioredis";
import {
  ensureDbUser,
  AuthenticatedRequest,
} from "../middleware/ensureDbUser.js";

// Create Redis connection
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// Create queues
const storyQueue = new Queue(QUEUE_NAMES.STORY_GENERATION, {
  connection: redis,
});

const illustrationQueue = new Queue(QUEUE_NAMES.ILLUSTRATION_GENERATION, {
  connection: redis,
});

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

      // Verify book ownership
      const book = await prisma.book.findFirst({
        where: { id: bookId, userId },
        include: {
          pages: true,
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
        data: { status: "ILLUSTRATING" },
      });

      // Filter pages to generate illustrations for
      const pagesToIllustrate = pageIds
        ? book.pages.filter((p) => pageIds.includes(p.id))
        : book.pages.filter((p) => p.text && !p.generatedImageUrl);

      // Add each page to illustration queue
      for (const page of pagesToIllustrate) {
        await illustrationQueue.add("generate-illustration", {
          bookId,
          userId,
          pageId: page.id,
          pageNumber: page.pageNumber,
          text: page.text || "",
          artStyle: book.artStyle || "watercolor",
          isWinkifyEnabled: book.isWinkifyEnabled,
          illustrationNotes: page.illustrationNotes,
        });
      }

      res.json({
        success: true,
        message: `Illustration generation started for ${pagesToIllustrate.length} pages`,
      });
    } catch (error) {
      next(error);
    }
  },
);
