/**
 * Client-side i18next initialization.
 *
 * The browser bundle imports this once from `entry.client.tsx`. It wires:
 *
 *  - `i18next-http-backend` for lazy-loading namespace JSON from
 *    `/locales/{lng}/{ns}.json` (the static files in `public/locales`).
 *  - `i18next-browser-languagedetector` as a *fallback only* — under normal
 *    conditions the server renders with the locale already chosen by the
 *    detector chain in `i18n.server.ts`, hydrates `<html lang>`, and the
 *    root loader hands the client an explicit `locale` value via
 *    `useChangeLanguage`. The detector is here for the rare cases that
 *    bypass the loader (e.g. error boundaries that mount before hydration).
 *
 * Phase 2 string-extraction work consumes this implicitly through
 * `useTranslation()`. Components don't need to import this file.
 *
 * See `docs/i18n-contract.md` for namespace conventions and the
 * `<route>.handle = { i18n: [...] }` pattern that drives lazy loading.
 */

import i18next from "i18next";
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

/**
 * Idempotent client init. Safe to call multiple times — i18next short-circuits
 * if it's already initialized. We export a promise so callers (entry.client)
 * can `await` it before hydration if they ever want to, but in practice the
 * loader-driven `useChangeLanguage` covers the warm-up path.
 */
export async function initI18nClient(): Promise<typeof i18next> {
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
      // We only ship the short codes (`en`, `es`); strip region tags
      // ("en-US" → "en") so a browser-detected `pt-BR` doesn't try to load a
      // 404'ing `pt-BR/common.json`.
      load: "languageOnly",
      // i18next inserts strings via React, which already escapes — double
      // escaping turns "&" into "&amp;" in placeholders. Disable.
      interpolation: { escapeValue: false },
      // Backend: lazy-load each namespace from /locales/{lng}/{ns}.json. The
      // public/locales tree is shipped as a static asset by the worker.
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
        // SSR-safe: don't suspend on missing translations during the initial
        // render. The loader-provided bundle covers the common namespace, and
        // route-declared namespaces stream in via `useTranslation`.
        useSuspense: false,
      },
    });
  return i18next;
}
