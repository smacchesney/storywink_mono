import * as Sentry from '@sentry/nextjs';

// Edge runtime (middleware, edge routes) Sentry init.
//
// No-op when SENTRY_DSN is unset — see sentry.server.config.ts.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 0,
  });
}
