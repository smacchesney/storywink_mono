// Load environment variables FIRST - before any other imports that might use them
import { config } from "dotenv";
config();

import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import "express-async-errors";

// Import routes
import { healthRouter } from "./routes/health.js";
import { booksRouter } from "./routes/books.js";
import { pagesRouter } from "./routes/pages.js";
import { assetsRouter } from "./routes/assets.js";
import { uploadRouter } from "./routes/upload.js";
import { generateRouter } from "./routes/generate.js";

// Import middleware
import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import { corsMiddleware } from "./middleware/cors.js";

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(helmet());
app.use(corsMiddleware);
app.use(
  pinoHttp({
    level: process.env.NODE_ENV === "production" ? "warn" : "warn",
    redact: ["req.headers.authorization"], // Hide sensitive auth tokens
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        query: req.query,
        params: req.params,
        // Remove verbose headers from logs
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check route - BEFORE authentication middleware
app.use("/api/health", healthRouter);

// Clerk authentication middleware
app.use(clerkMiddleware());

// Protected routes
app.use("/api/books", booksRouter);
app.use("/api/pages", pagesRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/generate", generateRouter);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server
// Add a simple test endpoint
app.get("/api/test", (_req, res) => {
  console.log("Test endpoint hit");
  res.json({ 
    message: "API is running", 
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL_SET: !!process.env.DATABASE_URL,
      DATABASE_URL_LENGTH: process.env.DATABASE_URL?.length || 0
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 API server running on port ${PORT}`);
  console.log(`Health check endpoint: /api/health`);
  console.log(`Test endpoint: /api/test`);
  console.log(`DATABASE_URL configured: ${!!process.env.DATABASE_URL}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`🔄 Deployment: ${new Date().toISOString()}`);
});
