/**
 * Client-side i18next initialization.
 *
 * The browser bundle imports this once from `entry.client.tsx`, which
 * passes the `{ lng, resources }` it pulled out of the SSR loader data. The
 * server has already populated `<I18nextProvider>` with the same bundle so
 * the very first hydration render produces translated strings — the SSR and
 * CSR markup match, and there's no flash of raw translation keys.
 *
 * Wiring:
 *
 *  - `i18next-http-backend` is kept available for the rare case where a
 *    namespace isn't in the inlined bundle (e.g. the user switches language
 *    via the LanguageSwitcher; the new locale's JSON is fetched on demand).
 *  - `i18next-browser-languagedetector` is a *fallback only* — under normal
 *    conditions the server renders with the locale already chosen by the
 *    detector chain in `i18n.server.ts` and `entry.client` passes that
 *    locale in explicitly. The detector covers the rare cases that bypass
 *    the loader (e.g. error boundaries that mount before hydration).
 *
 * See `docs/i18n-contract.md` for namespace conventions and the
 * `<route>.handle = { i18n: [...] }` pattern.
 */

import i18next, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import HttpBackend from "i18next-http-backend";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_NAMESPACE,
  I18N_NAMESPACES,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LANGUAGE_CODES,
} from "~/lib/i18n-config";

export interface InitI18nClientArgs {
  /** Locale resolved by the server-side detector chain. */
  lng?: string;
  /**
   * Pre-bundled resources keyed by language. Shape matches `i18next.init({
   * resources })`. Pass the `{ [lng]: { common, auth, ... } }` map that the
   * root loader returned so hydration matches SSR.
   */
  resources?: Resource;
}

/**
 * Idempotent client init. Safe to call multiple times — i18next short-circuits
 * if it's already initialized. Returns the i18next instance so callers can
 * pass it to `<I18nextProvider>`.
 */
export async function initI18nClient(
  args: InitI18nClientArgs = {},
): Promise<typeof i18next> {
  if (i18next.isInitialized) return i18next;

  await i18next
    .use(initReactI18next)
    .use(LanguageDetector)
    .use(HttpBackend)
    .init({
      // The full list of supported codes is shared between client and server
      // via `i18n-config.ts` — never hand-maintained in two places.
      supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
      fallbackLng: DEFAULT_LANGUAGE,
      defaultNS: DEFAULT_NAMESPACE,
      ns: [...I18N_NAMESPACES],
      // Explicit locale from the server. When absent, the detector chain
      // (cookie → navigator → htmlTag) picks one — used only when something
      // bypasses the root loader.
      lng: args.lng,
      // Pre-bundled translations from the SSR payload. With these in place,
      // every `useTranslation()` call resolves synchronously on first render
      // and the HTTP backend stays idle for the inlined language.
      resources: args.resources,
      // The bundled language is "complete" from i18next's POV but other
      // languages aren't bundled — leave the door open for the http backend
      // to fetch them when `useChangeLanguage` switches.
      partialBundledLanguages: true,
      // We only ship the short codes (`en`, `es`); strip region tags
      // ("en-US" → "en") so a browser-detected `pt-BR` doesn't try to load a
      // 404'ing `pt-BR/common.json`.
      load: "languageOnly",
      // i18next inserts strings via React, which already escapes — double
      // escaping turns "&" into "&amp;" in placeholders. Disable.
      interpolation: { escapeValue: false },
      // Backend: lazy-load namespaces from /locales/{lng}/{ns}.json. Only
      // hit for languages not already in `resources` (e.g. after a
      // language-switch). The public/locales tree ships as a static asset.
      backend: {
        loadPath: "/locales/{{lng}}/{{ns}}.json",
      },
      // Detector chain: cookie first (matches the server-side priority), then
      // the browser's preferred language. We deliberately omit `localStorage`
      // and `sessionStorage` — the server can't see those, and divergence
      // between server-rendered HTML and client hydration is the worst kind
      // of i18n bug to debug.
      detection: {
        order: ["cookie", "navigator", "htmlTag"],
        lookupCookie: LOCALE_COOKIE_NAME,
        caches: ["cookie"],
        cookieMinutes: 60 * 24 * 365, // 1 year
        cookieOptions: { path: "/", sameSite: "lax" },
      },
      react: {
        // SSR-safe: don't suspend on missing translations. The bundle is
        // already in `resources`, so suspense would never trigger anyway —
        // explicit-off keeps behavior consistent across error boundaries.
        useSuspense: false,
      },
    });
  return i18next;
}
