import * as Sentry from '@sentry/nextjs';

// Server-side (Node.js runtime) Sentry init.
//
// No-op when SENTRY_DSN is unset: Sentry.init with an undefined DSN disables
// the SDK entirely, so local dev and CI need no Sentry configuration. We also
// early-return so we don't even call init without a DSN.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Keep tracing off by default; opt in via env when needed.
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 0,
  });
}
