import * as Sentry from "@sentry/react-router";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import { initI18nClient } from "~/i18n";

declare const __SENTRY_RELEASE__: string;

function getSentryDsn() {
  if (typeof document === "undefined") return undefined;
  return (
    document
      .querySelector('meta[name="pickup-roster-sentry-dsn"]')
      ?.getAttribute("content") ?? undefined
  );
}

Sentry.init({
  dsn: getSentryDsn(),
  release:
    typeof __SENTRY_RELEASE__ !== "undefined" ? __SENTRY_RELEASE__ : undefined,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1
});

// Initialize i18next *before* hydration so `useTranslation()` returns real
// strings on the very first render (no flash of translation keys). The root
// loader also passes the resolved locale + initial namespace bundle through
// loaderData; `useChangeLanguage` in `root.tsx` keeps i18n in sync after.
async function hydrate() {
  await initI18nClient();
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <I18nextProvider i18n={i18next}>
          <HydratedRouter />
        </I18nextProvider>
      </StrictMode>
    );
  });
}

hydrate();
