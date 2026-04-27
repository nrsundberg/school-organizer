/**
 * Healthcheck endpoint contract.
 *
 * `GET /api/healthz` MUST be reachable without authentication. External
 * uptime monitors / Cloudflare load-balancer origin-health checks /
 * k8s-style readiness probes hit this endpoint with no cookies and follow
 * redirects — if it 302's to `/login`, those probes report the worker as
 * "healthy" on a rendered HTML 200 and never actually validate the
 * worker's runtime state.
 *
 * Regression caught by:
 *   - 2026-04-23-2317-scan
 *   - 2026-04-24-0001-scan
 *   - 2026-04-26-0320-scan
 *   - 2026-04-27-0318-scan
 *
 * Fix (2026-04-27): `pathname === "/api/healthz"` is added to the
 * `publicMarketingPath` allowlist in
 * `app/domain/utils/global-context.server.ts`, mirroring the `/status`
 * pattern shipped on 2026-04-25.
 */
import { test, expect } from "@playwright/test";

test.describe("/api/healthz", () => {
  test("is reachable without auth and returns JSON 200", async ({ request }) => {
    const res = await request.get("/api/healthz", { maxRedirects: 0 });
    expect(res.status(), "no auth redirect — endpoint must be publicly reachable")
      .toBe(200);
    expect(res.headers()["content-type"] ?? "").toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
    expect(typeof body.ts).toBe("string");
  });

  test("does not 302 to /login for an unauthenticated probe", async ({ request }) => {
    const res = await request.get("/api/healthz", { maxRedirects: 0 });
    expect(res.status()).not.toBe(302);
    const location = res.headers()["location"] ?? "";
    expect(location).not.toMatch(/\/login/);
  });
});
