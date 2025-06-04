import { Router } from "express";
import prisma from "../database/index.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    console.log("Starting health check...");
    console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);
    console.log("DATABASE_URL length:", process.env.DATABASE_URL?.length || 0);
    
    // Check database connection
    console.log("Attempting database query...");
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log("Database query successful:", result);

    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "storywink-api",
      version: process.env.npm_package_version || "1.0.0",
    });
  } catch (error) {
    console.error("Health check database error:", error);
    console.error("Error type:", typeof error);
    console.error("Error name:", error instanceof Error ? error.name : 'unknown');
    console.error("Error message:", error instanceof Error ? error.message : String(error));
    
    res.status(503).json({
      success: false,
      status: "unhealthy",
      error: "Database connection failed",
      details: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.name : typeof error,
    });
  }
});
