import { Router } from "express";
import { requireAuth } from "@clerk/express";
import prisma from "../database/index.js";
import {
  ensureDbUser,
  AuthenticatedRequest,
} from "../middleware/ensureDbUser.js";

export const assetsRouter = Router();

// Apply auth middleware to all routes
assetsRouter.use(requireAuth());
assetsRouter.use(ensureDbUser);

// GET /api/assets - Get all assets for the authenticated user
assetsRouter.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;

    const assets = await prisma.asset.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      success: true,
      data: assets,
    });
  } catch (error) {
    next(error);
  }
});
