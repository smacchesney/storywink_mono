import { createElement } from 'react';
import { toast } from 'sonner';
import logger from '@/lib/logger';
import { Storydust } from '@/components/ui/storydust';

/**
 * The working toast — a winking twinkle beside the message. Use for
 * fire-and-forget jobs (re-illustration, background saves) so the parent sees
 * the brand "we're on it" mark until the surface itself takes over. Sticks
 * around a little longer than a normal toast for exactly that handoff.
 */
export const showWorking = (message: string) => {
  toast(message, {
    icon: createElement(Storydust, { variant: 'twinkle', size: 'inline' }),
    duration: 8000,
  });
};

/**
 * Get appropriate duration for a toast message based on word count
 * Minimum 3 seconds, maximum 7 seconds
 */
export const getToastDuration = (message: string): number => {
  const words = message.split(' ').length;
  return Math.min(3000 + words * 200, 7000);
};

/**
 * Extract a loggable message from various error types. This text is for the
 * log only — it never reaches the parent (docs/voice.md, Rule 3).
 */
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'An unexpected error occurred';
};

/**
 * Show an error toast. The parent sees only the translated `message` (and
 * optional translated `description`); the raw error goes to the log.
 */
export const showError = (error: unknown, message: string, description?: string) => {
  logger.error({ err: getErrorMessage(error) }, `Error toast shown: ${message}`);

  toast.error(message, {
    description,
    duration: getToastDuration(message + (description || '')),
  });
};

/**
 * Show an error toast with a retry action. Same rule: translated copy only,
 * raw error to the log. `retryLabel` should come from the caller's catalog
 * (e.g. common.retry).
 */
export const showErrorWithRetry = (
  error: unknown,
  message: string,
  onRetry: () => void,
  retryLabel: string,
  description?: string,
) => {
  logger.error({ err: getErrorMessage(error) }, `Error toast shown: ${message}`);

  toast.error(message, {
    description,
    duration: 5000,
    action: {
      label: retryLabel,
      onClick: onRetry,
    },
  });
};

/**
 * Show a success toast with optional action
 */
export const showSuccess = (
  message: string,
  options?: {
    description?: string;
    action?: {
      label: string;
      onClick: () => void;
    };
  },
) => {
  toast.success(message, {
    description: options?.description,
    duration: getToastDuration(message + (options?.description || '')),
    action: options?.action,
  });
};

/**
 * Show a warning toast
 */
export const showWarning = (message: string, description?: string) => {
  toast.warning(message, {
    description,
    duration: getToastDuration(message + (description || '')),
  });
};

/**
 * Show an info toast (use sparingly)
 */
export const showInfo = (message: string, description?: string) => {
  toast.info(message, {
    description,
    duration: getToastDuration(message + (description || '')),
  });
};
