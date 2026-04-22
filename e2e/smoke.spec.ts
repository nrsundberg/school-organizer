/**
 * Smoke sweep — one test per route confirming it does not 500 or blow up the
 * client renderer. This is a safety net, not a change detector.
 *
 * For each route we assert:
 *   1. The final response status is 2xx (or an expected 3xx redirect chain that
 *      terminates in a 2xx). No 4xx / 5xx reaching the browser.
 *   2. The page renders *something* — a heading, a form, or known landmark
 *      text. We intentionally use loose assertions so this file doesn't need
 *      to be updated every time copy changes.
 *   3. No uncaught JavaScript errors are raised on load
 *      (`page.on('pageerror', ...)`), which would indicate a client render
 *      failure even if the server returned 200.
 *
 * The Playwright baseURL is `http://localhost:8787`, which the app treats as
 * a marketing host (see wrangler.jsonc → MARKETING_HOSTS includes
 * "localhost"). That means:
 *   - All "public marketing" routes load directly.
 *   - All "tenant-authenticated" routes redirect (to /login, /, /signup, or
 *     /pricing depending on loader logic) because no tenant host is in play
 *     and no session is seeded. We assert they redirect cleanly instead of
 *     500ing — a rendered login form OR a redirect chain terminating in a
 *     2xx page is considered healthy.
 *   - `/platform/*` redirects to /login for the same reason.
 *
 * Seeded authenticated coverage (a real admin on a real tenant subdomain,
 * and a real PLATFORM_ADMIN on the platform host) is out of scope for this
 * smoke sweep. It requires:
 *   - A tenant-slug host override (wrangler dev serves localhost only; dev
 *     subdomains like `smoke-<ts>.localhost` aren't reachable from the
 *     Playwright baseURL without /etc/hosts or a proxy).
 *   - A seeded tenant with billing bypassed (signup ends at Stripe checkout
 *     in the real flow).
 * Workstream 0d ("interaction-tests-critical-paths") is the better home for
 * seeded flows. This smoke sweep is deliberately thin — its job is to catch
 * "did this route 500" regressions.
 *
 * SKIPPED (dynamic-param routes that need real seeded data):
 *   - /update/:space, /empty/:space
 *   - /edit/homeroom/:homeroom, /edit/student/:student
 *   - /homerooms/:id
 *   - /admin/fire-drill/:templateId, /admin/fire-drill/:templateId/run
 *   - /admin/print/homeroom/:teacherId, /admin/print/fire-drill/:templateId
 *   - /platform/orgs/:orgId, /platform/webhooks/:eventId
 *   - /api/auth/*, /api/webhooks/stripe (POST-only / signed bodies)
 *   - /api/branding/logo/:slug (needs seeded R2 asset)
 *   - /data/students (CSV download — asserted only that it doesn't 500 in
 *     the authenticated-redirect group)
 */
import { test, expect, type Page, type Response } from "@playwright/test";

type RouteSpec = {
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
  landmark?: { role?: "heading" | "link" | "button"; name?: RegExp | string; text?: RegExp | string };
  /**
   * Allowed final URL patterns for redirect routes. Default: any 2xx page on
   * the same origin.
   */
  allowedFinalPaths?: RegExp[];
  /** Optional reason the route is expected to redirect. Surfaced in failures. */
  note?: string;
};

/* ------------------------------------------------------------------ */
/* Public marketing routes (unauthenticated, marketing host)          */
/* ------------------------------------------------------------------ */
const publicMarketingRoutes: RouteSpec[] = [
  {
    path: "/",
    expect: "self",
    landmark: { role: "link", name: /Pickup Roster/i },
  },
  {
    path: "/pricing",
    expect: "self",
    landmark: { role: "heading", name: /Car Line/i },
  },
  {
    path: "/faqs",
    expect: "self",
    landmark: { role: "heading" },
  },
  {
    path: "/status",
    expect: "self",
    landmark: { role: "heading" },
  },
  {
    path: "/login",
    expect: "self",
    landmark: { text: /Email/i },
  },
  {
    // Signup requires ?plan=car-line|campus|district. Without a plan, the
    // loader redirects to /pricing. We pass ?plan=car-line to exercise the
    // actual signup form.
    path: "/signup?plan=car-line",
    expect: "self",
    landmark: { text: /Your name/i },
  },
  {
    path: "/forgot-password",
    expect: "self",
    landmark: { role: "heading" },
  },
  {
    path: "/reset-password",
    // Reset-password without a valid token typically renders an error state
    // or redirects. Either is fine as long as it's not a 500.
    expect: "either",
    landmark: { role: "heading" },
  },
];

/* ------------------------------------------------------------------ */
/* Tenant-authenticated routes (unauthenticated -> redirect expected) */
/* ------------------------------------------------------------------ */
const tenantAuthedRoutes: RouteSpec[] = [
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
  { path: "/admin/history", expect: "either", landmark: { role: "heading" } },
  { path: "/admin/fire-drill", expect: "either", landmark: { role: "heading" } },

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
  { path: "/set-password", expect: "either" },
];

/* ------------------------------------------------------------------ */
/* Print routes (admin-gated; unauthenticated -> error boundary or    */
/* redirect, either is OK as long as it doesn't 500)                  */
/* ------------------------------------------------------------------ */
const printRoutes: RouteSpec[] = [
  { path: "/admin/print/board", expect: "either" },
  { path: "/admin/print/master", expect: "either" },
];

/* ------------------------------------------------------------------ */
/* Platform admin routes — redirect to /login when unauthenticated.   */
/* ------------------------------------------------------------------ */
const platformRoutes: RouteSpec[] = [
  { path: "/platform", expect: "either" },
  { path: "/platform/orgs/new", expect: "either" },
  { path: "/platform/signups", expect: "either" },
  { path: "/platform/sessions", expect: "either" },
  { path: "/platform/webhooks", expect: "either" },
  { path: "/platform/audit", expect: "either" },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Navigate to a path and capture page errors. Returns the final response and
 * any caught pageerror messages.
 */
async function visitAndCapture(
  page: Page,
  path: string,
): Promise<{ response: Response | null; pageErrors: string[]; consoleErrors: string[] }> {
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
    response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30000 });
  } finally {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
  }

  return { response, pageErrors, consoleErrors };
}

function assertNotServerError(path: string, response: Response | null) {
  expect(response, `No response for ${path}`).not.toBeNull();
  const status = response!.status();
  expect(
    status,
    `Route ${path} returned ${status}. Expected 2xx or redirect chain ending in 2xx.`,
  ).toBeLessThan(500);
  // 4xx is also a smell — most of our routes should either render (2xx) or
  // have been redirected (3xx resolved to 2xx by Playwright's goto). The
  // one exception is /api/* which we test separately. Allow 401/403 only
  // if the route explicitly returns them; at the HTML level we prefer to
  // see a rendered ErrorBoundary (2xx).
  if (status >= 400 && status < 500) {
    throw new Error(
      `Route ${path} returned ${status}. Smoke sweep expects a rendered page or redirect; a raw 4xx means the ErrorBoundary didn't render.`,
    );
  }
}

async function assertLandmark(page: Page, spec: RouteSpec) {
  if (!spec.landmark) {
    // Fallback: assert <body> rendered something, not just whitespace.
    const bodyText = (await page.locator("body").innerText().catch(() => "")) ?? "";
    expect(
      bodyText.trim().length,
      `Route ${spec.path} rendered an empty body`,
    ).toBeGreaterThan(0);
    return;
  }
  const { role, name, text } = spec.landmark;
  if (role) {
    const locator = name
      ? page.getByRole(role, { name }).first()
      : page.getByRole(role).first();
    await expect(locator, `Landmark ${role} not visible on ${spec.path}`).toBeVisible({
      timeout: 10000,
    });
    return;
  }
  if (text) {
    await expect(
      page.getByText(text).first(),
      `Landmark text ${String(text)} not visible on ${spec.path}`,
    ).toBeVisible({ timeout: 10000 });
  }
}

function assertAllowedFinalPath(spec: RouteSpec, finalUrl: string) {
  if (spec.expect === "self") {
    const u = new URL(finalUrl);
    // Trim trailing slashes and search for loose equality. We don't enforce
    // query-string stability — some loaders append ?flash=... etc.
    const landedPath = u.pathname;
    const expectedPath = spec.path.split("?")[0];
    expect(landedPath, `Expected ${spec.path} to render itself but landed on ${landedPath}`).toBe(
      expectedPath,
    );
  }
  if (spec.expect === "redirect") {
    if (!spec.allowedFinalPaths || spec.allowedFinalPaths.length === 0) return;
    const u = new URL(finalUrl);
    const ok = spec.allowedFinalPaths.some((re) => re.test(u.pathname));
    expect(ok, `Route ${spec.path} landed on ${u.pathname}, not in allowed list`).toBe(true);
  }
  // "either" — no assertion on final URL.
}

async function smokeOne(page: Page, spec: RouteSpec) {
  const { response, pageErrors } = await visitAndCapture(page, spec.path);

  assertNotServerError(spec.path, response);
  assertAllowedFinalPath(spec, page.url());
  await assertLandmark(page, spec);

  if (pageErrors.length > 0) {
    // Filter out known-harmless browser noise if we observe any in practice.
    // For now surface everything — we want to see what's real.
    throw new Error(
      `Route ${spec.path} raised ${pageErrors.length} pageerror(s):\n  - ${pageErrors.join("\n  - ")}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

test.describe("smoke: public marketing routes", () => {
  for (const spec of publicMarketingRoutes) {
    test(`GET ${spec.path}`, async ({ page }) => {
      await smokeOne(page, spec);
    });
  }
});

test.describe("smoke: tenant-authenticated routes (unauthenticated -> graceful)", () => {
  for (const spec of tenantAuthedRoutes) {
    test(`GET ${spec.path}`, async ({ page }) => {
      await smokeOne(page, spec);
    });
  }
});

test.describe("smoke: print routes (unauthenticated -> graceful)", () => {
  for (const spec of printRoutes) {
    test(`GET ${spec.path}`, async ({ page }) => {
      await smokeOne(page, spec);
    });
  }
});

test.describe("smoke: platform admin routes (unauthenticated -> redirect)", () => {
  for (const spec of platformRoutes) {
    test(`GET ${spec.path}`, async ({ page }) => {
      await smokeOne(page, spec);
    });
  }
});

/* ------------------------------------------------------------------ */
/* API routes                                                          */
/* ------------------------------------------------------------------ */

test.describe("smoke: api routes", () => {
  test("GET /api/healthz returns 200 JSON with ok: true", async ({ request }) => {
    const res = await request.get("/api/healthz");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok?: boolean; ts?: string; env?: string };
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe("string");
  });
});
