export type SentryEnv = {
  SENTRY_DSN?: string;
  SENTRY_RELEASE?: string;
  ENVIRONMENT?: string;
};

export function getSentryConfig(env: SentryEnv) {
  if (!env.SENTRY_DSN) return null;
  return {
    dsn: env.SENTRY_DSN,
    release: env.SENTRY_RELEASE,
    environment: env.ENVIRONMENT ?? "production",
    tracesSampleRate: 0.1,
  };
}

// Re-export captureException from @sentry/cloudflare for use in server-side
// error handlers. The actual Sentry init happens via withSentry() in
// workers/app.ts — do NOT call Sentry.init() here.
export { captureException } from "@sentry/cloudflare";
