import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  type MiddlewareFunction,
  Outlet,
  redirect,
  Scripts,
  ScrollRestoration,
  useRouteError
} from "react-router";
import { useEffect } from "react";
import { getToast } from "remix-toast";
import { toast as notify, ToastContainer } from "react-toastify";
import toastStyles from "react-toastify/ReactToastify.css?url";
import styles from "./app.css?url";
import type { Route } from "./+types/root";
import { useChangeLanguage } from "remix-i18next/react";
import { detectLocale } from "~/i18n.server";
import { DEFAULT_LANGUAGE } from "~/lib/i18n-config";
// Initial common-namespace bundle shipped with the SSR response. The full
// JSON for other namespaces is fetched lazily by the http backend (see
// app/i18n.ts) once a route declares them via `handle = { i18n: [...] }`.
import enCommon from "../public/locales/en/common.json";
import esCommon from "../public/locales/es/common.json";

const COMMON_BUNDLES: Record<string, unknown> = {
  en: enCommon,
  es: esCommon,
};
import {
  globalStorageMiddleware,
  userContext,
  getOptionalOrgFromContext,
  getTenantPrisma
} from "~/domain/utils/global-context.server";
import { isMarketingHost } from "~/domain/utils/host.server";
import { getTenantBoardUrlForRequest } from "~/domain/utils/tenant-board-url.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { ImpersonationBanner } from "~/components/ImpersonationBanner";
import { Footer } from "~/components/Footer";
import logo from "/logo-icon.svg?url";
import { getBrandingFromOrg } from "~/domain/org/branding.server";
import { HEX_COLOR_RE } from "~/domain/org/branding-constants";
import {
  DEFAULT_SITE_NAME,
  DEFAULT_SUPPORT_EMAIL,
  getSupportEmail
} from "~/lib/site";
import { getActiveDrillRun } from "~/domain/drills/live.server";
import {
  liveDrillRedirectTarget,
  userIsAdmin
} from "~/domain/drills/live-redirect.server";
import { getCspNonceFromRequest } from "~/lib/csp";

export const middleware: MiddlewareFunction<Response>[] = [
  globalStorageMiddleware
];

/**
 * Build the `:root { --color-primary: ...; --color-secondary: ...; }` override
 * CSS string for the current request. Returns `null` when nothing should be
 * injected (marketing host, or neither color set).
 *
 * Every value is re-validated against {@link HEX_COLOR_RE} here so that the
 * caller can safely use `dangerouslySetInnerHTML`. Anything that doesn't match
 * is dropped silently — we never emit an unvalidated color into the style tag.
 */
function buildPaletteOverrideCss(args: {
  marketing: boolean;
  primary: string | null;
  secondary: string | null;
}): string | null {
  if (args.marketing) return null;
  const decls: string[] = [];
  if (args.primary && HEX_COLOR_RE.test(args.primary)) {
    decls.push(`--color-primary:${args.primary};`);
  }
  if (args.secondary && HEX_COLOR_RE.test(args.secondary)) {
    decls.push(`--color-secondary:${args.secondary};`);
  }
  if (decls.length === 0) return null;
  return `:root{${decls.join("")}}`;
}

export const meta: Route.MetaFunction = ({ data }) => {
  if (!data) {
    return [
      { title: DEFAULT_SITE_NAME },
      {
        name: "description",
        content: "Live car line board, viewer access, and school admin tools."
      },
      { name: "theme-color", content: "#3D6B9A" }
    ];
  }
  if (data.marketing) {
    return [
      { title: `${DEFAULT_SITE_NAME} — Car line made clear` },
      {
        name: "description",
        content: "Live car line board, viewer access, and school admin tools."
      },
      { name: "theme-color", content: "#3D6B9A" }
    ];
  }
  const name = data.branding?.orgName ?? DEFAULT_SITE_NAME;
  return [
    { title: `${name} — Car line` },
    { name: "description", content: `${name} car line board.` },
    { name: "theme-color", content: "#3D6B9A" }
  ];
};

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: styles },
  { rel: "stylesheet", href: toastStyles },
  { rel: "icon", href: "/favicon.ico", sizes: "any" },
  { rel: "icon", href: "/logo-icon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/logo-32.png", type: "image/png", sizes: "32x32" },
  { rel: "icon", href: "/logo-192.png", type: "image/png", sizes: "192x192" },
  { rel: "apple-touch-icon", href: "/logo-180.png" },
  { rel: "manifest", href: "/site.webmanifest" }
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = context.get(userContext) ?? null;
  const org = getOptionalOrgFromContext(context);
  const marketing = isMarketingHost(request, context);
  const { toast, headers } = await getToast(request);

  // Live drill takeover: when a drill is LIVE or PAUSED in this org, non-admin
  // signed-in users are force-redirected to /drills/live. Admins stay on
  // whatever route they requested so they can manage things. The allow-list
  // (logout, /api/*, static assets) is encapsulated in liveDrillRedirectTarget
  // so it's unit-testable and consistent across callers.
  if (!marketing && user && org && !userIsAdmin(user)) {
    try {
      const prisma = getTenantPrisma(context);
      const activeRun = await getActiveDrillRun(prisma, org.id);
      if (activeRun) {
        const url = new URL(request.url);
        const target = liveDrillRedirectTarget({
          user,
          pathname: url.pathname,
          hasActiveDrill: true,
          isAdmin: false
        });
        if (target) {
          throw redirect(target);
        }
      }
    } catch (e) {
      // Let redirects propagate; swallow DB lookup errors so a transient D1
      // hiccup doesn't take down the whole app shell.
      if (e instanceof Response) throw e;
    }
  }

  let impersonatedBy: string | null = null;
  if (user) {
    try {
      const auth = getAuth(context);
      const session = await auth.api.getSession({ headers: request.headers });
      impersonatedBy = (session?.session as any)?.impersonatedBy ?? null;
    } catch {
      // ignore
    }
  }

  // On marketing pages, surface the logged-in user's tenant board URL so the
  // marketing header can swap "Log in" for a "Dashboard" button that points
  // straight into their tenant subdomain.
  let dashboardUrl: string | null = null;
  if (marketing && user?.orgId) {
    try {
      dashboardUrl = await getTenantBoardUrlForRequest(request, context);
    } catch {
      dashboardUrl = null;
    }
  }

  // Run the i18n detector chain once per request so every loader downstream
  // can read the locale from the matched root route. We also ship the
  // initial `common` namespace bundle inline so the very first render has
  // strings available without an extra fetch round-trip.
  const locale = await detectLocale(request, context);
  const i18nResources = {
    common: COMMON_BUNDLES[locale] ?? COMMON_BUNDLES[DEFAULT_LANGUAGE],
  };

  return data(
    {
      toast,
      user,
      impersonatedBy,
      branding: getBrandingFromOrg(org),
      marketing,
      dashboardUrl,
      supportEmail: getSupportEmail(context),
      sentryDsn: (context as any).cloudflare?.env?.SENTRY_DSN ?? null,
      cspNonce: getCspNonceFromRequest(request),
      locale,
      i18nResources
    },
    { headers }
  );
}

// Surfaces the i18n namespaces the root render needs. Phase 2 routes
// declare additional namespaces with their own `handle = { i18n: [...] }`.
export const handle = { i18n: ["common"] };

export function ErrorBoundary() {
  const error = useRouteError();

  let title = "Something went wrong";
  let message = "An unexpected error occurred. Please try again.";
  let statusCode: number | null = null;

  if (isRouteErrorResponse(error)) {
    statusCode = error.status;
    if (error.status === 401) {
      title = "Not Logged In";
      message = "You need to be logged in to access this page.";
    } else if (error.status === 403) {
      title = "Access Denied";
      message = "You don't have permission to view this page.";
    } else if (error.status === 404) {
      title = "Page Not Found";
      message = "The page you're looking for doesn't exist.";
    } else {
      message = error.statusText || message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <html lang="en" className="dark bg-[#212525]">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`Error — ${DEFAULT_SITE_NAME}`}</title>
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-[#212525] text-white flex flex-col">
        <div className="h-10 w-full bg-blue-300 flex items-center justify-center flex-shrink-0 relative">
          <a href="/" className="text-black font-bold inline-flex items-center">
            <img src={logo} alt="school logo" height={40} width={40} />
            {`${DEFAULT_SITE_NAME} — Car line`}
          </a>
          <a
            href="/login"
            className="border border-black p-1 rounded-lg absolute right-2 text-black text-sm"
          >
            Login
          </a>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          {statusCode && (
            <p className="text-blue-300 text-6xl font-bold mb-2">
              {statusCode}
            </p>
          )}
          <h1 className="text-2xl font-semibold mb-3">{title}</h1>
          <p className="text-white/60 mb-6 text-center max-w-sm">{message}</p>
          <a
            href="/"
            className="bg-blue-300 text-black font-semibold px-4 py-2 rounded-lg hover:bg-blue-400 transition-colors"
          >
            Go Home
          </a>
        </div>
        <Footer
          siteName={DEFAULT_SITE_NAME}
          supportEmail={DEFAULT_SUPPORT_EMAIL}
        />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const {
    toast,
    user,
    impersonatedBy,
    branding,
    supportEmail,
    sentryDsn,
    marketing,
    cspNonce,
    locale
  } = loaderData;

  // Keep i18next in lock-step with the loader-resolved locale. Triggers
  // `i18n.changeLanguage(locale)`, which the http backend then uses to
  // load any missing namespace JSON for that language.
  useChangeLanguage(locale);

  useEffect(() => {
    if (toast) {
      notify(toast.message, { type: toast.type, theme: "dark" });
    }
  }, [toast]);

  // Tenant palette override: render :root { --color-primary: X; --color-secondary: Y }
  // only on tenant hosts, only for colors that pass the hex regex. The apex
  // marketing host always uses the default palette.
  const paletteOverrideCss = buildPaletteOverrideCss({
    marketing,
    primary: branding?.primaryColorOverride ?? null,
    secondary: branding?.secondaryColorOverride ?? null
  });

  return (
    <html lang={locale} className="dark bg-[#212525]">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Loading...</title>
        <Meta />
        <Links />
        {sentryDsn && (
          <meta name="pickup-roster-sentry-dsn" content={sentryDsn} />
        )}
        {paletteOverrideCss && (
          <style
            nonce={cspNonce ?? undefined}
            // eslint-disable-next-line react/no-danger -- values are pre-validated
            // against HEX_COLOR_RE; anything that doesn't match is stripped before
            // reaching this template (see buildPaletteOverrideCss).
            dangerouslySetInnerHTML={{ __html: paletteOverrideCss }}
          />
        )}
      </head>
      <body
        className="min-h-screen flex flex-col"
        style={{
          ["--brand-primary" as string]: branding.primaryColor,
          ["--brand-accent" as string]: branding.accentColor
        }}
      >
        {/* Skip link for keyboard users — visible only when focused. WCAG 2.4.1 */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[1000] focus:rounded-md focus:bg-[#E9D500] focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#193B4B] focus:outline-none focus:ring-2 focus:ring-white"
        >
          Skip to main content
        </a>
        {impersonatedBy && user && (
          <ImpersonationBanner userName={user.name || user.email} />
        )}
        <ToastContainer />
        <main id="main-content" className="flex-1">
          <Outlet />
        </main>
        <Footer
          siteName={DEFAULT_SITE_NAME}
          supportEmail={supportEmail}
          orgName={branding?.orgName ?? null}
        />
        <ScrollRestoration nonce={cspNonce ?? undefined} />
        <Scripts nonce={cspNonce ?? undefined} />
      </body>
    </html>
  );
}
