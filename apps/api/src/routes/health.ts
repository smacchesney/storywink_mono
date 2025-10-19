import { Router } from "express";
import prisma from "../database/index.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  // Basic health check - just verify server is running
  // Don't fail on database/redis issues during startup
  const health: {
    success: boolean;
    status: string;
    timestamp: string;
    service: string;
    version: string;
    env: {
      DATABASE_URL: boolean;
      REDIS_URL: boolean;
      CLERK_SECRET_KEY: boolean;
    };
    database?: string;
  } = {
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "storywink-api",
    version: process.env.npm_package_version || "1.0.0",
    env: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      REDIS_URL: !!process.env.REDIS_URL,
      CLERK_SECRET_KEY: !!process.env.CLERK_SECRET_KEY,
    }
  };

  try {
    // Optional: try database connection but don't fail healthcheck if it's down
    if (process.env.DATABASE_URL) {
      await prisma.$queryRaw`SELECT 1 as test`;
      health.database = "connected";
    } else {
      health.database = "not configured";
    }
  } catch (error) {
    console.warn("Database connection check failed (healthcheck still passes):", error);
    health.database = "error";
  }

  res.json(health);
});
