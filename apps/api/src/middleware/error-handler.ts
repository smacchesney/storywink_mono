import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  // Log error
  req.log.error({ err }, "Request error");

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: "Validation error",
      details: err.errors,
    });
    return;
  }

  // Handle known errors
  if (err.message.includes("Unauthorized")) {
    res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
    return;
  }

  if (err.message.includes("Not found")) {
    res.status(404).json({
      success: false,
      error: err.message,
    });
    return;
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
