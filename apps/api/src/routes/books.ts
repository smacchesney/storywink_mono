import { Router } from "express";
import { requireAuth } from "@clerk/express";
import prisma from "../database/index.js";
import { createBookSchema, updateBookSchema } from "@storywink/shared";
import {
  ensureDbUser,
  AuthenticatedRequest,
} from "../middleware/ensureDbUser.js";

export const booksRouter = Router();

// Apply auth middleware to all routes
booksRouter.use(requireAuth());
booksRouter.use(ensureDbUser);

// GET /api/books - Get all books for the authenticated user
booksRouter.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;

    const books = await prisma.book.findMany({
      where: { userId },
      include: {
        pages: {
          orderBy: { pageNumber: "asc" },
          include: {
            asset: {
              select: {
                id: true,
                url: true,
                thumbnailUrl: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json({
      success: true,
      data: books,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/books/:bookId - Get a specific book
booksRouter.get("/:bookId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const { bookId } = req.params;
    const userId = req.dbUser!.id;

    const book = await prisma.book.findFirst({
      where: {
        id: bookId,
        userId,
      },
      include: {
        pages: {
          orderBy: { pageNumber: "asc" },
          include: {
            asset: {
              select: {
                id: true,
                url: true,
                thumbnailUrl: true,
              },
            },
          },
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

    res.json({
      success: true,
      data: book,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/books - Create a new book
booksRouter.post("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;
    const body = createBookSchema.parse(req.body);

    // First, get asset URLs to populate originalImageUrl
    const assets = await prisma.asset.findMany({
      where: { id: { in: body.assetIds } },
      select: { id: true, url: true, thumbnailUrl: true },
    });

    // Create a map for quick lookup
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));

    // Create book with pages
    const book = await prisma.book.create({
      data: {
        userId,
        title: '', // Empty title - will be set in editor
        pageLength: body.pageLength,
        artStyle: body.artStyle,
        tone: body.tone,
        theme: body.theme,
        status: "DRAFT",
        pages: {
          create: body.assetIds.map((assetId, index) => {
            const asset = assetMap.get(assetId);
            return {
              assetId,
              pageNumber: index + 1,
              index,
              isTitlePage: index === 0,
              pageType: "SINGLE" as const,
              originalImageUrl: asset?.thumbnailUrl || asset?.url || null,
            };
          }),
        },
      },
      include: {
        pages: {
          orderBy: { pageNumber: "asc" },
          include: {
            asset: true,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      data: book,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/books/:bookId - Update a book
booksRouter.patch("/:bookId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const { bookId } = req.params;
    const userId = req.dbUser!.id;
    const body = updateBookSchema.parse(req.body);

    // Verify ownership
    const existingBook = await prisma.book.findFirst({
      where: { id: bookId, userId },
    });

    if (!existingBook) {
      res.status(404).json({
        success: false,
        error: "Book not found",
      });
      return;
    }

    // Update book
    const book = await prisma.book.update({
      where: { id: bookId },
      data: body,
      include: {
        pages: {
          orderBy: { pageNumber: "asc" },
          include: {
            asset: {
              select: {
                id: true,
                url: true,
                thumbnailUrl: true,
              },
            },
          },
        },
      },
    });

    res.json({
      success: true,
      data: book,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/books/:bookId - Delete a book
booksRouter.delete("/:bookId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const { bookId } = req.params;
    const userId = req.dbUser!.id;

    // Verify ownership
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
    });

    if (!book) {
      res.status(404).json({
        success: false,
        error: "Book not found",
      });
      return;
    }

    // Delete book (cascade will delete pages)
    await prisma.book.delete({
      where: { id: bookId },
    });

    res.json({
      success: true,
      message: "Book deleted successfully",
    });
  } catch (error) {
    next(error);
  }
});
