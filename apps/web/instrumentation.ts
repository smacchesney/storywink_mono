import * as Sentry from '@sentry/nextjs';

// Next.js instrumentation hook. Loads the runtime-appropriate Sentry config.
// Each config is a silent no-op when SENTRY_DSN is unset, so this adds no
// behavior in local dev or CI where the DSN is absent.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Capture errors thrown in nested React Server Components and route handlers.
// captureRequestError is a no-op when Sentry was never initialized (no DSN).
export const onRequestError = Sentry.captureRequestError;
