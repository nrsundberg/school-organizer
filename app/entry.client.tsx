import * as Sentry from "@sentry/react-router";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import type { Resource } from "i18next";
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

/**
 * Pull the root loader's `{ locale, i18nResources }` out of the React
 * Router hydration global so we can seed i18next with the same bundle the
 * server used. SSR and CSR render with identical strings → no flash of
 * translation keys, and React hydration sees matching markup.
 *
 * `window.__reactRouterContext.state.loaderData.root` is the canonical
 * location — RR7 only emits root loader data into the initial hydration
 * payload (other route data streams in afterwards), which is exactly what
 * we need here.
 */
function readSsrI18n(): { lng?: string; resources?: Resource } {
  if (typeof window === "undefined") return {};
  const ctx = (
    window as unknown as {
      __reactRouterContext?: {
        state?: {
          loaderData?: Record<
            string,
            { locale?: unknown; i18nResources?: unknown } | undefined
          >;
        };
      };
    }
  ).__reactRouterContext;
  const rootData = ctx?.state?.loaderData?.root;
  const lng =
    typeof rootData?.locale === "string" ? rootData.locale : undefined;
  const bundle = rootData?.i18nResources as Resource[string] | undefined;
  if (!lng || !bundle) return { lng };
  return { lng, resources: { [lng]: bundle } };
}

// Initialize i18next *before* hydration with the SSR-shipped bundle so
// `useTranslation()` returns real strings on the very first render. The
// root loader passes the resolved locale + bundle through loaderData, and
// `useChangeLanguage` in `root.tsx` keeps i18n in sync after.
async function hydrate() {
  await initI18nClient(readSsrI18n());
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
