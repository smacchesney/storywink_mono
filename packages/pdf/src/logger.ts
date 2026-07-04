import type { PdfLogger } from './types.js';

/**
 * Default logger used when a consumer does not supply one.
 *
 * Mirrors the workers copy's `console.log` behaviour: emits a `[PDF]` prefix
 * and appends the structured context so nothing is silently dropped.
 */
export const consolePdfLogger: PdfLogger = {
  info: (context, message) => console.log(`[PDF] ${message}`, context),
  warn: (context, message) => console.warn(`[PDF] ${message}`, context),
  error: (context, message) => console.error(`[PDF] ${message}`, context),
};

export function resolveLogger(logger?: PdfLogger): PdfLogger {
  return logger ?? consolePdfLogger;
}
