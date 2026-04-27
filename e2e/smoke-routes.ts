/**
 * Shared route catalog + helpers used by both the desktop smoke sweep
 * (`smoke.spec.ts`) and the mobile smoke sweep (`smoke.mobile.spec.ts`).
 *
 * Having both files operate off the same source-of-truth list avoids drift
 * when new routes are added: updating this file reaches every viewport.
 *
 * See `smoke.spec.ts` for the rationale behind the assertion model
 * (expect "self" | "redirect" | "either", landmark check, no pageerror, etc.).
 */
import { expect, type Page, type Response } from "@playwright/test";

export type RouteSpec = {
  path: string;
  /**
   * Expected landing mode after following redirects:
   *  - "self"        : the response URL matches the requested path (2xx).
   *  - "redirect"    : we expect to land on a different URL (e.g. /login,
   *                    /pricing, /). We just assert status is 2xx and
   *                    final URL is one of the allowed ones.
   *  - "either"      : either is fine. Used for routes whose behavior
   *                    depends on whether the user has an org/session.
   */
  expect: "self" | "redirect" | "either";
  /**
   * If provided, assert this text/selector is visible once the page settles.
   * Used as a smoke-level "something rendered" check. For redirect routes,
   * the text is matched on the landed page.
   */
  landmark?: {
    role?: "heading" | "link" | "button";
    name?: RegExp | string;
    text?: RegExp | string;
  };
  /**
   * Allowed final URL patterns for redirect routes. Default: any 2xx page on
   * the same origin.
   */
  allowedFinalPaths?: RegExp[];
  /** Optional reason the route is expected to redirect. Surfaced in failures. */
  note?: string;
  /**
   * If set, mark the test as `test.fixme(...)` — it will not fail CI, but it
   * will be visible in the Playwright report as "expected to fail".
   * Use this ONLY for real bugs the smoke sweep has uncovered, so the test
   * documents the expected correct behavior without papering over the bug.
   */
  fixme?: string;
};

/* ------------------------------------------------------------------ */
/* Public marketing routes (unauthenticated, marketing host)          */
/* ------------------------------------------------------------------ */
export const publicMarketingRoutes: RouteSpec[] = [
  {
    path: "/",
    expect: "self",
    // Covers the current wordmark+logo header.
    landmark: { role: "link", name: /Pickup Roster/i }
  },
  {
    path: "/pricing",
    expect: "self",
    landmark: { role: "heading", name: /Car Line/i }
  },
  {
    path: "/faqs",
    expect: "self",
    landmark: { role: "heading" }
  },
  {
    // Blog index is linked from the marketing nav + footer on every page, so
    // signed-out visitors MUST be able to hit it. The middleware in
    // app/domain/utils/global-context.server.ts gates `publicMarketingPath`;
    // if `/blog` and `/blog/*` aren't whitelisted there, this sweep will
    // catch the regression before staging smoke does.
    path: "/blog",
    expect: "self",
    landmark: { role: "heading", name: /Field notes/i }
  },
  {
    // Sample post path — exercises the `/blog/$slug` loader on marketing host
    // for signed-out visitors. Slug tracks the most recently dated file in
    // content/blog/. If this post is ever removed, swap for another.
    path: "/blog/parent-communication-confirming-pickup-changes-without-chaos",
    expect: "self",
    landmark: { role: "heading" }
  },
  {
    // Guides index is linked from the marketing nav. Same gating concern as
    // /blog — `publicMarketingPath` in
    // app/domain/utils/global-context.server.ts must include /guides and
    // /guides/*, or signed-out visitors get bounced to /login.
    path: "/guides",
    expect: "self",
    landmark: { role: "heading", name: /How to set up/i },
  },
  {
    // Sample guide slug — exercises the `/guides/$slug` loader. Tracks the
    // most recently dated file in content/guides/. Swap if removed.
    path: "/guides/setting-up-your-first-drill-template",
    expect: "self",
    landmark: { role: "heading" },
  },
  {
    // BUG: /status redirects to /login?next=/status on marketing host +
    // no session. The middleware in
    // app/domain/utils/global-context.server.ts does not list /status in
    // `publicMarketingPath`, so unauthenticated visitors get kicked to
    // login. Status pages must be publicly visible.
    path: "/status",
    expect: "self",
    landmark: { role: "heading" }
  },
  {
    path: "/login",
    expect: "self",
    landmark: { text: /Email/i }
  },
  {
    // Signup requires ?plan=car-line|campus|district. Without a plan, the
    // loader redirects to /pricing. We pass ?plan=car-line to exercise the
    // actual signup form.
    path: "/signup?plan=car-line",
    expect: "self",
    landmark: { text: /Your name/i }
  },
  {
    path: "/forgot-password",
    expect: "self",
    landmark: { role: "heading" }
  },
  {
    path: "/reset-password",
    // Reset-password without a valid token typically renders an error state
    // or redirects. Either is fine as long as it's not a 500.
    expect: "either",
    landmark: { role: "heading" }
  }
];

/* ------------------------------------------------------------------ */
/* Tenant-authenticated routes (unauthenticated -> redirect expected) */
/* ------------------------------------------------------------------ */
export const tenantAuthedRoutes: RouteSpec[] = [
  // Tenant board index — on marketing host + no user, hitting "/" renders
  // marketing. On tenant host + no user, it redirects to /login. On
  // localhost (marketing host), we treat this as "self" with marketing
  // landmark. Already covered in publicMarketingRoutes above.

  // Admin layout loader requires an admin user. With no session, it 401s
  // through the in-route ErrorBoundary which renders a "Login Required"
  // page — that's a 2xx HTML response with a heading. Good.
  { path: "/admin", expect: "either", landmark: { role: "heading" } },
  { path: "/admin/users", expect: "either", landmark: { role: "heading" } },
  { path: "/admin/children", expect: "either", landmark: { role: "heading" } },
  { path: "/admin/billing", expect: "either", landmark: { role: "heading" } },
  { path: "/admin/branding", expect: "either", landmark: { role: "heading" } },
  // /admin/history is listed in the nightly spec but not registered in
  // app/routes.ts on master. The nightly queue was drafted alongside the
  // in-progress drills rename (which adds history). Once that lands we can
  // turn this on. Skipping here so the sweep doesn't fail on a route that
  // doesn't exist yet.
  // { path: "/admin/history", expect: "either", landmark: { role: "heading" } },
  {
    path: "/admin/fire-drill",
    expect: "either",
    landmark: { role: "heading" }
  },

  // `/create/*` — these loaders typically require admin + org.
  { path: "/create/homeroom", expect: "either", landmark: { role: "heading" } },
  { path: "/create/student", expect: "either", landmark: { role: "heading" } },

  // `/homerooms` — viewer or admin route.
  { path: "/homerooms", expect: "either", landmark: { role: "heading" } },

  // `/viewer-access` — redirects to "/" on marketing host (no org). That's
  // fine; we just want no 500.
  { path: "/viewer-access", expect: "either" },

  // Billing pages.
  { path: "/billing/success", expect: "either" },
  { path: "/billing/cancel", expect: "either" },
  { path: "/billing-required", expect: "either" },

  // Set-password — redirects to /login if no user.
  { path: "/set-password", expect: "either" }
];

/* ------------------------------------------------------------------ */
/* Print routes (admin-gated; unauthenticated -> error boundary or    */
/* redirect, either is OK as long as it doesn't 500)                  */
/* ------------------------------------------------------------------ */
export const printRoutes: RouteSpec[] = [
  { path: "/admin/print/board", expect: "either" },
  { path: "/admin/print/master", expect: "either" }
];

/* ------------------------------------------------------------------ */
/* Platform admin routes — redirect to /login when unauthenticated.   */
/* ------------------------------------------------------------------ */
export const platformRoutes: RouteSpec[] = [
  { path: "/platform", expect: "either" },
  { path: "/platform/orgs/new", expect: "either" },
  { path: "/platform/signups", expect: "either" },
  { path: "/platform/sessions", expect: "either" },
  { path: "/platform/webhooks", expect: "either" },
  { path: "/platform/audit", expect: "either" }
];

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Navigate to a path and capture page errors. Returns the final response and
 * any caught pageerror messages.
 */
export async function visitAndCapture(
  page: Page,
  path: string
): Promise<{
  response: Response | null;
  pageErrors: string[];
  consoleErrors: string[];
}> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  const onPageError = (err: Error) => {
    pageErrors.push(err.message);
  };
  const onConsole = (msg: import("@playwright/test").ConsoleMessage) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  };

  page.on("pageerror", onPageError);
  page.on("console", onConsole);

  let response: Response | null = null;
  try {
    response = await page.goto(path, {
      waitUntil: "commit",
      timeout: 30000
    });
  } finally {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
  }

  return { response, pageErrors, consoleErrors };
}

export function assertNotServerError(path: string, response: Response | null) {
  expect(response, `No response for ${path}`).not.toBeNull();
  const status = response!.status();
  expect(
    status,
    `Route ${path} returned ${status}. Expected 2xx or redirect chain ending in 2xx.`
  ).toBeLessThan(500);
  // 4xx is also a smell — most of our routes should either render (2xx) or
  // have been redirected (3xx resolved to 2xx by Playwright's goto). The
  // one exception is /api/* which we test separately. Allow 401/403 only
  // if the route explicitly returns them; at the HTML level we prefer to
  // see a rendered ErrorBoundary (2xx).
  if (status >= 400 && status < 500) {
    throw new Error(
      `Route ${path} returned ${status}. Smoke sweep expects a rendered page or redirect; a raw 4xx means the ErrorBoundary didn't render.`
    );
  }
}

export async function assertLandmark(page: Page, spec: RouteSpec) {
  if (!spec.landmark) {
    // Fallback: assert <body> rendered something, not just whitespace.
    const bodyText =
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) ?? "";
    expect(
      bodyText.trim().length,
      `Route ${spec.path} rendered an empty body`
    ).toBeGreaterThan(0);
    return;
  }
  const { role, name, text } = spec.landmark;
  if (role) {
    const locator = name
      ? page.getByRole(role, { name }).first()
      : page.getByRole(role).first();
    await expect(
      locator,
      `Landmark ${role} not visible on ${spec.path}`
    ).toBeVisible({
      timeout: 10000
    });
    return;
  }
  if (text) {
    await expect(
      page.getByText(text).first(),
      `Landmark text ${String(text)} not visible on ${spec.path}`
    ).toBeVisible({ timeout: 10000 });
  }
}

export function assertAllowedFinalPath(spec: RouteSpec, finalUrl: string) {
  if (spec.expect === "self") {
    const u = new URL(finalUrl);
    // Trim trailing slashes and search for loose equality. We don't enforce
    // query-string stability — some loaders append ?flash=... etc.
    const landedPath = u.pathname;
    const expectedPath = spec.path.split("?")[0];
    expect(
      landedPath,
      `Expected ${spec.path} to render itself but landed on ${landedPath}`
    ).toBe(expectedPath);
  }
  if (spec.expect === "redirect") {
    if (!spec.allowedFinalPaths || spec.allowedFinalPaths.length === 0) return;
    const u = new URL(finalUrl);
    const ok = spec.allowedFinalPaths.some((re) => re.test(u.pathname));
    expect(
      ok,
      `Route ${spec.path} landed on ${u.pathname}, not in allowed list`
    ).toBe(true);
  }
  // "either" — no assertion on final URL.
}

/**
 * Core smoke assertion used by desktop smoke. Navigates, asserts status is
 * not 5xx/4xx, confirms landmark, and rejects any uncaught pageerrors.
 */
export async function smokeOne(page: Page, spec: RouteSpec) {
  const { response, pageErrors } = await visitAndCapture(page, spec.path);

  assertNotServerError(spec.path, response);
  assertAllowedFinalPath(spec, page.url());
  await assertLandmark(page, spec);

  if (pageErrors.length > 0) {
    // Filter out known-harmless browser noise if we observe any in practice.
    // For now surface everything — we want to see what's real.
    throw new Error(
      `Route ${spec.path} raised ${pageErrors.length} pageerror(s):\n  - ${pageErrors.join("\n  - ")}`
    );
  }
}
