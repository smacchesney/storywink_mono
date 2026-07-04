import * as Sentry from '@sentry/nextjs';

// Browser-side Sentry init. Runs in the client bundle, so it reads the
// NEXT_PUBLIC_SENTRY_DSN value that Next inlines at build time.
//
// No-op when the DSN is unset (local dev, CI, or any build without the var):
// we skip init entirely, so the SDK stays dormant.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    // Session Replay is opt-in; leave sampling at 0 unless explicitly enabled.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

// Instruments client-side navigations so Sentry can tie errors to routes.
// A no-op when Sentry was not initialized above.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
