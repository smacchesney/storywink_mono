import { Router } from "express";
import { requireAuth } from "@clerk/express";
import prisma from "../database/index.js";
import { updatePageSchema } from "../shared/index.js";
import {
  ensureDbUser,
  AuthenticatedRequest,
} from "../middleware/ensureDbUser.js";

export const pagesRouter = Router();

// Apply auth middleware to all routes
pagesRouter.use(requireAuth());
pagesRouter.use(ensureDbUser);

// PATCH /api/pages/:bookId/:pageId - Update a page
pagesRouter.patch(
  "/:bookId/:pageId",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { bookId, pageId } = req.params;
      const userId = req.dbUser!.id;
      const body = updatePageSchema.parse(req.body);

      // Verify book ownership
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

      // Update page
      const page = await prisma.page.update({
        where: { id: pageId },
        data: body,
      });

      res.json({
        success: true,
        data: page,
      });
    } catch (error) {
      next(error);
    }
  },
);
