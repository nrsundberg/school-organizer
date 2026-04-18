import * as Sentry from "@sentry/react-router";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

declare const __SENTRY_RELEASE__: string;

Sentry.init({
  dsn: typeof window !== "undefined" ? (window as any).__sentryDsn : undefined,
  release:
    typeof __SENTRY_RELEASE__ !== "undefined" ? __SENTRY_RELEASE__ : undefined,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1,
});

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
