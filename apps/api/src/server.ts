import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { config } from "dotenv";
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

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3001;

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

// Clerk authentication middleware
app.use(clerkMiddleware());

// Routes
app.use("/api/health", healthRouter);
app.use("/api/books", booksRouter);
app.use("/api/pages", pagesRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/generate", generateRouter);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 API server running on port ${PORT}`);
});
