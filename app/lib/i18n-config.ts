/**
 * Shared i18n config — the single source of truth for which languages we
 * support and which i18next namespaces exist. Imported by both client init
 * (`app/i18n.ts`) and server init (`app/i18n.server.ts`), the language
 * switcher, the `/api/user-prefs` validator, and Phase 2 components that
 * declare per-route namespaces via `export const handle = { i18n: [...] }`.
 *
 * Adding a new language is a three-line change here plus a `public/locales/{code}/*.json`
 * tree (see docs/i18n-contract.md, "How to add a new language").
 */

/**
 * BCP-47 short codes for languages we ship UI translations for. Keep this
 * list narrow — every entry adds round-trip review work to every Phase 2
 * extraction, and we lazy-load JSON anyway so unused codes are pure cost.
 */
export const SUPPORTED_LANGUAGES = [
  { code: "en", nativeName: "English" },
  { code: "es", nativeName: "Español" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

/** Convenience array of just the codes — useful for validators / .includes(). */
export const SUPPORTED_LANGUAGE_CODES: readonly SupportedLanguage[] =
  SUPPORTED_LANGUAGES.map((l) => l.code);

/** Default language — used when nothing in the detector chain matches. */
export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

/**
 * The cookie that stores the user's chosen locale. Set by the language
 * switcher and read by the server-side detector chain in `i18n.server.ts`.
 *
 * Lower-case `lng` matches the i18next ecosystem default — both
 * `i18next-browser-languagedetector` and `remix-i18next` look for it under
 * this name, which means we don't need to override their defaults.
 */
export const LOCALE_COOKIE_NAME = "lng";

/**
 * One year in seconds. Mirrored on both the client (`document.cookie` Max-Age)
 * and any server-side Set-Cookie we issue, so refreshes don't flip the
 * effective expiry.
 */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * All i18next namespaces we ship. Keep these aligned with the JSON files
 * under `public/locales/{lng}/{namespace}.json`. The contract doc has the
 * "what goes where" cheat sheet.
 */
export const I18N_NAMESPACES = [
  "common",
  "roster",
  "admin",
  "billing",
  "auth",
  "email",
  "errors",
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

/** Default namespace loaded eagerly on every page — keep it small. */
export const DEFAULT_NAMESPACE: I18nNamespace = "common";

/**
 * Type guard / validator. Used by the API route that persists `User.locale`
 * and any server-side helper that needs to coerce an unknown string.
 */
export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(value)
  );
}

/**
 * Pick the closest supported language to the given code, falling back to
 * {@link DEFAULT_LANGUAGE}. Strips region tags (`en-US` → `en`) and
 * lower-cases. Mirrors the logic the server-side detector chain uses
 * internally so callers (e.g. `usePrintLocale`) can normalize too.
 */
export function pickSupportedLanguage(
  candidate: string | null | undefined,
): SupportedLanguage {
  if (!candidate) return DEFAULT_LANGUAGE;
  const short = candidate.toLowerCase().split(/[-_]/, 1)[0]!;
  return isSupportedLanguage(short) ? short : DEFAULT_LANGUAGE;
}
