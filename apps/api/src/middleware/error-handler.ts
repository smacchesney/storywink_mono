import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Log error
  req.log.error({ err }, "Request error");

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: err.errors,
    });
  }

  // Handle known errors
  if (err.message.includes("Unauthorized")) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
  }

  if (err.message.includes("Not found")) {
    return res.status(404).json({
      success: false,
      error: err.message,
    });
  }

  // Default error response
  res.status(500).json({
    success: false,
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
};
