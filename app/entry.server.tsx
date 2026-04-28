import type { EntryContext, HandleErrorFunction } from "react-router";
import { ServerRouter } from "react-router";
import { renderToReadableStream } from "react-dom/server";
import { isbot } from "isbot";
import { createInstance, type Resource } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { captureException } from "~/lib/sentry.server";
import { getCspNonceFromRequest } from "~/lib/csp";
import { getBundleForLanguage } from "~/lib/i18n-bundles";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_NAMESPACE,
  I18N_NAMESPACES,
  SUPPORTED_LANGUAGE_CODES,
  isSupportedLanguage,
} from "~/lib/i18n-config";

export const handleError: HandleErrorFunction = (error, { request }) => {
  // Don't report aborted requests (e.g. user navigated away mid-stream)
  if (!request.signal.aborted) {
    captureException(error);
    console.error(error);
  }
};

const ABORT_DELAY = 5_000;

/**
 * Build a per-request i18next instance preloaded with the resolved
 * language's bundle so SSR emits translated HTML — not raw translation
 * keys — and hydration on the client matches one-for-one.
 *
 * The instance is fresh per request; we never share state across the
 * worker isolate. `staticHandlerContext.loaderData.root.{locale,
 * i18nResources}` is the source of truth — both fields are populated by
 * the root loader which has already run by the time `handleRequest` is
 * called.
 */
async function createServerI18n(routerContext: EntryContext) {
  const rootLoaderData = (
    routerContext as unknown as {
      staticHandlerContext?: {
        loaderData?: Record<
          string,
          { locale?: unknown; i18nResources?: unknown } | undefined
        >;
      };
    }
  ).staticHandlerContext?.loaderData?.root;

  const candidate = rootLoaderData?.locale;
  const lng = isSupportedLanguage(candidate) ? candidate : DEFAULT_LANGUAGE;
  // The loader returns the bundle for `lng` only. If it's missing for any
  // reason (older cached loader output, error path), fall back to the
  // statically-imported bundle so SSR still has strings.
  const bundle =
    (rootLoaderData?.i18nResources as
      | Resource[string]
      | undefined) ?? (getBundleForLanguage(lng) as unknown as Resource[string]);
  const resources: Resource = { [lng]: bundle };

  const instance = createInstance();
  await instance.use(initReactI18next).init({
    lng,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
    defaultNS: DEFAULT_NAMESPACE,
    ns: [...I18N_NAMESPACES],
    resources,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return instance;
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
) {
  const userAgent = request.headers.get("user-agent");
  const waitForAll = (userAgent && isbot(userAgent)) || routerContext.isSpaMode;
  const cspNonce = getCspNonceFromRequest(request) ?? undefined;

  const i18n = await createServerI18n(routerContext);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ABORT_DELAY);

  const body = await renderToReadableStream(
    <I18nextProvider i18n={i18n}>
      <ServerRouter context={routerContext} nonce={cspNonce} url={request.url} />
    </I18nextProvider>,
    {
      nonce: cspNonce,
      signal: controller.signal,
      onError(error: unknown) {
        console.error(error);
        responseStatusCode = 500;
      }
    }
  );

  if (waitForAll) {
    await body.allReady;
  }

  clearTimeout(timeoutId);
  responseHeaders.set("Content-Type", "text/html");

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode
  });
}
