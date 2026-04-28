/**
 * Statically-imported translation bundles, keyed by language code.
 *
 * Used by:
 *  - `entry.server.tsx` to seed a per-request `<I18nextProvider>` so SSR
 *    emits translated HTML rather than raw keys.
 *  - `app/root.tsx` to ship the resolved language's bundle through loader
 *    data, so the client can hydrate with the same strings without an
 *    extra `/locales/{lng}/{ns}.json` round-trip.
 *  - `app/lib/t.server.ts` for the server-only `getFixedT` helper.
 *
 * Cloudflare Workers can't read JSON from disk at runtime, so the bundles
 * are imported here and Vite inlines them into the worker chunk. The cost
 * is one JSON parse per language × namespace at module-load time, which
 * runs once per isolate.
 */

import type { Resource } from "i18next";

import enCommon from "../../public/locales/en/common.json";
import enRoster from "../../public/locales/en/roster.json";
import enAdmin from "../../public/locales/en/admin.json";
import enBilling from "../../public/locales/en/billing.json";
import enAuth from "../../public/locales/en/auth.json";
import enEmail from "../../public/locales/en/email.json";
import enErrors from "../../public/locales/en/errors.json";
import esCommon from "../../public/locales/es/common.json";
import esRoster from "../../public/locales/es/roster.json";
import esAdmin from "../../public/locales/es/admin.json";
import esBilling from "../../public/locales/es/billing.json";
import esAuth from "../../public/locales/es/auth.json";
import esEmail from "../../public/locales/es/email.json";
import esErrors from "../../public/locales/es/errors.json";

import {
  DEFAULT_LANGUAGE,
  type SupportedLanguage,
} from "~/lib/i18n-config";

export type NamespaceBundle = Record<string, Record<string, unknown>>;

export const i18nBundles = {
  en: {
    common: enCommon as Record<string, unknown>,
    roster: enRoster as Record<string, unknown>,
    admin: enAdmin as Record<string, unknown>,
    billing: enBilling as Record<string, unknown>,
    auth: enAuth as Record<string, unknown>,
    email: enEmail as Record<string, unknown>,
    errors: enErrors as Record<string, unknown>,
  },
  es: {
    common: esCommon as Record<string, unknown>,
    roster: esRoster as Record<string, unknown>,
    admin: esAdmin as Record<string, unknown>,
    billing: esBilling as Record<string, unknown>,
    auth: esAuth as Record<string, unknown>,
    email: esEmail as Record<string, unknown>,
    errors: esErrors as Record<string, unknown>,
  },
} as const satisfies Record<SupportedLanguage, NamespaceBundle>;

/** All bundles flattened to the `Resource` shape `i18next.init({ resources })` expects. */
export const i18nResources: Resource = i18nBundles;

/**
 * Pick the bundle for a single language, falling back to {@link DEFAULT_LANGUAGE}
 * when the requested language isn't supported. Used by the root loader to
 * inline only the resolved language's bundle into the SSR payload.
 */
export function getBundleForLanguage(lng: string): NamespaceBundle {
  return (
    (i18nBundles as Record<string, NamespaceBundle>)[lng] ??
    i18nBundles[DEFAULT_LANGUAGE]
  );
}
