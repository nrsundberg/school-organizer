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
 *
 * ROUTE DATA is shared with `smoke.mobile.spec.ts` via `./smoke-routes.ts`
 * so the two sweeps stay in lockstep as routes are added.
 */
import { test, expect } from "@playwright/test";
import {
  publicMarketingRoutes,
  tenantAuthedRoutes,
  printRoutes,
  platformRoutes,
  smokeOne,
  type RouteSpec,
} from "./smoke-routes";

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

function defineRouteTest(spec: RouteSpec) {
  test(`GET ${spec.path}`, async ({ page }) => {
    if (spec.fixme) {
      test.fixme(true, spec.fixme);
    }
    await smokeOne(page, spec);
  });
}

test.describe("smoke: public marketing routes", () => {
  for (const spec of publicMarketingRoutes) {
    defineRouteTest(spec);
  }
});

test.describe("smoke: tenant-authenticated routes (unauthenticated -> graceful)", () => {
  for (const spec of tenantAuthedRoutes) {
    defineRouteTest(spec);
  }
});

test.describe("smoke: print routes (unauthenticated -> graceful)", () => {
  for (const spec of printRoutes) {
    defineRouteTest(spec);
  }
});

test.describe("smoke: platform admin routes (unauthenticated -> redirect)", () => {
  for (const spec of platformRoutes) {
    defineRouteTest(spec);
  }
});

/* ------------------------------------------------------------------ */
/* API routes                                                          */
/* ------------------------------------------------------------------ */

test.describe("smoke: api routes", () => {
  test("GET /api/healthz returns 200 JSON with ok: true", async ({ request }) => {
    // Regression coverage for the 2026-04-26 P0 fix: /api/healthz must be
    // whitelisted in anonSkipsViewer in
    // app/domain/utils/global-context.server.ts. Unauthenticated hits on
    // any host should land on the route handler, not bounce to /login.
    const res = await request.get("/api/healthz", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok?: boolean; ts?: string; env?: string };
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe("string");
  });

  test("GET /api/healthz does not 5xx", async ({ request }) => {
    // Even with the redirect bug above, the endpoint should never return a
    // 5xx. This is the minimum smoke assertion that keeps passing while the
    // redirect bug is open.
    const res = await request.get("/api/healthz");
    expect(res.status()).toBeLessThan(500);
  });
});
