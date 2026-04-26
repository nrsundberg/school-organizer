/**
 * Server-side i18n setup.
 *
 * Two responsibilities:
 *
 *  1. Implement the *detector chain* that picks a locale for an incoming
 *     request — used by the root loader and any route that needs to know
 *     the active language at SSR time.
 *
 *  2. Build a `remix-i18next` instance for `getRouteNamespaces(context)` /
 *     `getFixedT(...)` calls inside loaders. We don't lean on its
 *     auto-detection here; we run our own chain (below) so we can hit
 *     Prisma for the user/org locale.
 *
 * Detector priority (decided in the i18n plan):
 *
 *   1. `lng` cookie  — explicit user choice, set by LanguageSwitcher.
 *   2. `User.locale` — saved server-side preference for logged-in users.
 *   3. `Org.defaultLocale` — tenant fallback (also used by org-wide print).
 *   4. `Accept-Language` — best-effort browser preference.
 *   5. `DEFAULT_LANGUAGE` (en).
 *
 * Cloudflare Workers note: `fs` is not available at runtime. Server-side
 * translation lookups (`t.server.ts`) bundle the JSON via static imports
 * rather than reading from disk.
 */

import { RemixI18Next } from "remix-i18next/server";
import { createCookie } from "react-router";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_NAMESPACE,
  I18N_NAMESPACES,
  LOCALE_COOKIE_NAME,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  SUPPORTED_LANGUAGE_CODES,
  isSupportedLanguage,
  pickSupportedLanguage,
  type SupportedLanguage,
} from "~/lib/i18n-config";
import { getOptionalUserFromContext, getOptionalOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";

/**
 * The `lng` cookie wrapped as a react-router `Cookie` object — the shape
 * the `remix-i18next` language detector expects. Same attributes the
 * client-side switcher writes (1y, Lax, Path=/) so server and client
 * stay in sync.
 */
const localeCookie = createCookie(LOCALE_COOKIE_NAME, {
  path: "/",
  sameSite: "lax",
  maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
});

/**
 * Singleton `RemixI18Next` instance. Configured with our supported codes
 * and namespaces; consumers call `i18nServer.getRouteNamespaces(context)`
 * to discover which namespaces a render needs.
 *
 * The `detection` block is required by the constructor but we only use it
 * as a fallback — `detectLocale` below runs the real chain.
 */
export const i18nServer = new RemixI18Next({
  detection: {
    supportedLanguages: [...SUPPORTED_LANGUAGE_CODES],
    fallbackLanguage: DEFAULT_LANGUAGE,
    cookie: localeCookie,
  },
  i18next: {
    supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
    fallbackLng: DEFAULT_LANGUAGE,
    defaultNS: DEFAULT_NAMESPACE,
    ns: [...I18N_NAMESPACES],
  },
});

/**
 * Read the `lng=...` cookie value off a Request. Avoids pulling in a full
 * cookie parser — we only need this one key, and it's URL-safe so a simple
 * `; ` split is sufficient.
 */
function readLocaleCookie(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const [name, ...rest] = part.split("=");
    if (name === LOCALE_COOKIE_NAME) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

/**
 * Parse `Accept-Language: en-US,en;q=0.9,es;q=0.8` and return the
 * highest-priority value that matches our supported list. Falls back to
 * null when nothing matches — the caller decides what to do.
 */
function pickFromAcceptLanguage(request: Request): SupportedLanguage | null {
  const header = request.headers.get("Accept-Language");
  if (!header) return null;
  // Each entry is "code" or "code;q=0.8". Sort by q descending (default 1).
  const candidates = header
    .split(",")
    .map((entry) => {
      const [tag, ...params] = entry.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      const weight = q ? parseFloat(q.slice(2)) : 1;
      return { tag: (tag ?? "").toLowerCase(), weight: isNaN(weight) ? 0 : weight };
    })
    .filter((c) => c.tag.length > 0)
    .sort((a, b) => b.weight - a.weight);

  for (const { tag } of candidates) {
    const short = tag.split(/[-_]/, 1)[0]!;
    if (isSupportedLanguage(short)) return short;
  }
  return null;
}

/**
 * Run the full detector chain for an incoming request and return the
 * resolved locale. Pure function (no header mutation) — callers that want
 * to pin the cookie to the resolved value can do so in their own response.
 *
 * `context` is the React Router context; if it carries `userContext` or
 * `orgContext` (populated by `globalStorageMiddleware`) we use those rather
 * than re-querying the DB. When called outside the middleware (e.g. before
 * it runs), the user/org steps are skipped harmlessly.
 *
 * IMPORTANT: this function never throws on DB errors — i18n must not be
 * able to take down the app shell. A failed locale lookup just falls
 * through to the next chain entry.
 */
export async function detectLocale(
  request: Request,
  context: any,
): Promise<SupportedLanguage> {
  // 1. Explicit cookie — set by the language switcher. Always wins so users
  //    who picked a language can never get bounced back by a stale browser
  //    Accept-Language header.
  const fromCookie = readLocaleCookie(request);
  if (fromCookie) {
    const picked = pickSupportedLanguage(fromCookie);
    if (isSupportedLanguage(fromCookie) || picked !== DEFAULT_LANGUAGE) {
      return picked;
    }
  }

  // 2. Logged-in user's saved preference (User.locale column).
  const user = context ? getOptionalUserFromContext(context) : null;
  if (user && (user as any).locale && isSupportedLanguage((user as any).locale)) {
    return (user as any).locale as SupportedLanguage;
  }

  // 3. Tenant default (Org.defaultLocale). Comes from middleware if present;
  //    otherwise we don't try to resolve the org here — that's expensive and
  //    the middleware already does it for every routed request.
  const org = context ? getOptionalOrgFromContext(context) : null;
  if (org && (org as any).defaultLocale && isSupportedLanguage((org as any).defaultLocale)) {
    return (org as any).defaultLocale as SupportedLanguage;
  }

  // 4. Best-effort browser preference.
  const fromHeader = pickFromAcceptLanguage(request);
  if (fromHeader) return fromHeader;

  // 5. Hard fallback.
  return DEFAULT_LANGUAGE;
}

/**
 * Helper: look up a teacher's effective print locale.
 *
 * Used by the homeroom print route to honor `Teacher.locale` when set,
 * with a fallback to the org default. Centralized here so the rule is
 * consistent across `usePrintLocale` and any server-side caller.
 */
export async function getTeacherPrintLocale(
  context: any,
  teacherId: number | string,
): Promise<SupportedLanguage> {
  try {
    const id = typeof teacherId === "string" ? parseInt(teacherId, 10) : teacherId;
    if (!Number.isFinite(id)) {
      return getOrgDefaultLocale(context);
    }
    // Tenant-scoped: the extension AND-injects the request's orgId so a
    // teacherId belonging to another org returns null instead of leaking
    // that org's locale.
    const prisma = getTenantPrisma(context);
    const teacher = await prisma.teacher.findFirst({
      where: { id },
      select: { locale: true },
    });
    if (teacher?.locale && isSupportedLanguage(teacher.locale)) {
      return teacher.locale;
    }
  } catch {
    // Fall through to org default (also catches the no-org-in-context path).
  }
  return getOrgDefaultLocale(context);
}

/** Current request's org default locale, with a hard fallback. */
export function getOrgDefaultLocale(context: any): SupportedLanguage {
  const org = getOptionalOrgFromContext(context);
  const value = (org as any)?.defaultLocale;
  return isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE;
}
