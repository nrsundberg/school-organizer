/**
 * Server-only `t` helper.
 *
 * Used outside React — email templates, Zod error maps, thrown `Response`
 * messages, anything where we don't have a `useTranslation()` hook to lean
 * on. The signature mirrors `react-i18next` so call sites read the same:
 *
 *     const t = await getFixedT("es", "email");
 *     const subject = t("welcome.subject", { name: user.name });
 *
 * Cloudflare Workers note: we cannot read JSON from disk at runtime
 * (`i18next-fs-backend` blows up in the worker isolate), so the
 * translations are statically imported. Vite bundles them into the worker
 * chunk; the cost is small (one JSON per supported lang × namespace) and
 * we get end-to-end edge-rendered translations with no IO. The deliverable
 * spec mentions `i18next-fs-backend` — it's installed for tooling/test
 * paths and `i18next-parser` consistency, but the runtime intentionally
 * doesn't use it. See `docs/i18n-contract.md` ("Server-side `t` usage").
 *
 * Each call gets a *fresh* i18next instance — independent from the React
 * one, no global state to leak across requests on the worker isolate. The
 * cost is a few-microseconds-per-call init; in practice we only call this
 * a handful of times per email send / form action.
 */

import i18next, { type TFunction } from "i18next";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_NAMESPACE,
  I18N_NAMESPACES,
  SUPPORTED_LANGUAGE_CODES,
  pickSupportedLanguage,
  type I18nNamespace,
} from "~/lib/i18n-config";
import { i18nResources as resources } from "~/lib/i18n-bundles";
import { detectLocale } from "~/i18n.server";

/**
 * Get a `t` function pinned to a specific language and namespace(s).
 *
 * Mirrors `i18next.getFixedT(lng, ns)`. Use the result inside a single
 * request handler; don't stash it on module scope — the language is per
 * request.
 */
export async function getFixedT(
  lng: string,
  ns: I18nNamespace | I18nNamespace[] = DEFAULT_NAMESPACE,
): Promise<TFunction> {
  const language = pickSupportedLanguage(lng);
  const namespaces = Array.isArray(ns) ? ns : [ns];

  // Independent instance per call: avoids cross-request state on the worker
  // isolate, which is small enough to spin up on every invocation.
  const instance = i18next.createInstance({
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
    ns: [...I18N_NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    resources,
    interpolation: { escapeValue: false },
  });
  await instance.init();

  return instance.getFixedT(
    language,
    namespaces.length === 1 ? (namespaces[0] as I18nNamespace) : (namespaces as I18nNamespace[]),
  );
}

/**
 * Resolve the request's locale and return a `t` function for the admin UI.
 *
 * Collapses the `detectLocale(request, context)` → `getFixedT(locale, ns)`
 * pair that opens nearly every admin loader/action. Defaults to the "admin"
 * namespace; pass extra namespaces (e.g. `["admin", "errors"]`) when a handler
 * also needs them. Use it only when the raw `locale` value isn't needed
 * separately — if a handler also formats numbers/dates with the locale, keep
 * the explicit `detectLocale` call.
 *
 * @param request - incoming request (cookie / Accept-Language inputs).
 * @param context - RR router context (resolved user/org locale).
 * @param ns - i18n namespace(s) to pin; defaults to `"admin"`.
 * @returns a `t` translator pinned to the resolved locale and namespace(s).
 */
export async function getAdminT(
  request: Request,
  context: any,
  ns: I18nNamespace | I18nNamespace[] = "admin",
): Promise<TFunction> {
  const locale = await detectLocale(request, context);
  return getFixedT(locale, ns);
}
