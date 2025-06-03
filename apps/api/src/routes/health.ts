import { Router } from "express";
import prisma from "../database/index.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "storywink-api",
      version: process.env.npm_package_version || "1.0.0",
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: "unhealthy",
      error: "Database connection failed",
    });
  }
});
