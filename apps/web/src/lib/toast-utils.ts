import { toast } from 'sonner';

/**
 * Get appropriate duration for a toast message based on word count
 * Minimum 3 seconds, maximum 7 seconds
 */
export const getToastDuration = (message: string): number => {
  const words = message.split(' ').length;
  return Math.min(3000 + (words * 200), 7000);
};

/**
 * Extract a user-friendly error message from various error types
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
 * Show a contextual error toast with actionable messages
 */
export const showError = (error: unknown, context?: string) => {
  const message = getErrorMessage(error);
  const isNetworkError = message.toLowerCase().includes('network') || 
                        message.toLowerCase().includes('connection') ||
                        message.toLowerCase().includes('fetch');
  
  const description = isNetworkError 
    ? "Check your connection and try again"
    : message;

  toast.error(context || "Something went wrong", {
    description,
    duration: getToastDuration(description),
  });
};

/**
 * Show an error toast with a retry action
 */
export const showErrorWithRetry = (
  error: unknown, 
  context: string,
  onRetry: () => void
) => {
  const message = getErrorMessage(error);
  
  toast.error(context, {
    description: message,
    duration: 5000,
    action: {
      label: "Retry",
      onClick: onRetry
    }
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
  }
) => {
  toast.success(message, {
    description: options?.description,
    duration: getToastDuration(message + (options?.description || '')),
    action: options?.action
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