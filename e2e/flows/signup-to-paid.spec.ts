/**
 * signup-to-paid critical path — checkout (Stripe) boundary.
 *
 * Covers the POST `/api/billing/checkout` redirect boundary without driving
 * Stripe's hosted Checkout UI:
 *
 *   1. **Authed admin → Stripe** — an authed admin POSTs a valid plan; the
 *      action calls `createCheckoutSessionForOrg` and 302/303-redirects to
 *      `https://checkout.stripe.com/...`. Also asserts the org's
 *      `stripeCustomerId` was lazily populated as a side effect.
 *      Conditionally `test.fixme`'d if `STRIPE_SECRET_KEY` is missing from
 *      `.dev.vars` (the same file `wrangler dev` loads).
 *
 *   2. **Anonymous → /login** — an unauthenticated POST is bounced to
 *      `/login` (via `redirectWithError`) BEFORE any Stripe call, and never
 *      reaches `checkout.stripe.com`. Runs regardless of Stripe config.
 *
 * Adapted from the original 2026-04-25 spec for current master:
 *   - The original "trial leg" drove the 3-step signup UI with
 *     `?plan=district` to exercise the no-card trial branch. On current
 *     master `/signup?plan=district` redirects to a dedicated
 *     `/district/signup` wizard (see app/routes/auth/signup.tsx), so that
 *     premise no longer maps to the main signup route. The trial leg is
 *     omitted here rather than rewritten against a different wizard it was
 *     never designed for; the checkout boundary below is the higher-value,
 *     request-based (non-flaky) coverage and aligns with master's
 *     app/routes/api/billing.checkout.ts.
 *
 * What this spec deliberately does NOT cover:
 *   - Driving the actual checkout.stripe.com page (no headless Stripe).
 *   - The /billing/success?session_id=... return-from-Stripe leg (covered
 *     by Stripe webhook unit tests).
 *
 * Quality rule (from the queue): if any assertion fails because of a real
 * app bug, do NOT paper over it — flag it as `.fixme` with a comment and
 * surface it in the build summary.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { test, expect, type SeededTenant } from "../fixtures/seeded-tenant";

/* ------------------------------------------------------------------ */
/* Environment helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Returns true iff `.dev.vars` (the same file `wrangler dev` reads) has a
 * non-empty `STRIPE_SECRET_KEY`. We check the file rather than
 * `process.env.STRIPE_SECRET_KEY` because the Playwright runner doesn't
 * inherit wrangler's env, and we want the gate condition to actually
 * predict whether the worker request will succeed.
 */
function stripeIsConfigured(): boolean {
  try {
    const filePath = path.resolve(process.cwd(), ".dev.vars");
    const content = readFileSync(filePath, "utf8");
    const match = content.match(/^STRIPE_SECRET_KEY\s*=\s*(.+)$/m);
    if (!match) return false;
    const value = match[1].trim().replace(/^["']|["']$/g, "");
    return value.length > 0;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Checkout leg — POST /api/billing/checkout → Stripe redirect       */
/* ------------------------------------------------------------------ */

test.describe("@flow signup-to-paid — checkout leg (Stripe redirect)", () => {
  test("POST /api/billing/checkout redirects to checkout.stripe.com for an authed admin", async ({
    request,
    tenant,
  }: {
    request: import("@playwright/test").APIRequestContext;
    tenant: SeededTenant;
  }) => {
    test.fixme(
      !stripeIsConfigured(),
      "STRIPE_SECRET_KEY missing from .dev.vars — set the Stripe test creds to run this leg.",
    );

    // Build the cookie header by hand — APIRequestContext doesn't pick up
    // cookies from a `page.context()` we never created here, and the
    // tenant fixture's `adminCookie` is shaped for `addCookies()` not the
    // raw header.
    const cookieHeader = `${tenant.adminCookie.name}=${tenant.adminCookie.value}`;
    const url = tenant.tenantUrl("/api/billing/checkout");

    // POST with `maxRedirects: 0` so the Stripe-bound 302/303 surfaces in
    // the response rather than getting silently followed.
    const response = await request.post(url, {
      headers: {
        cookie: cookieHeader,
        "content-type": "application/x-www-form-urlencoded",
      },
      data: "plan=CAR_LINE&billingCycle=monthly",
      maxRedirects: 0,
    });

    expect(
      [302, 303],
      `expected redirect status, got ${response.status()} ${response.statusText()}`,
    ).toContain(response.status());

    const location = response.headers()["location"] ?? "";
    expect(
      location,
      `expected Location header → checkout.stripe.com, got: ${location || "<none>"}`,
    ).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    // Side-effect assertion: createCheckoutSessionForOrg lazily populates
    // Org.stripeCustomerId on the first call. The seeded-tenant fixture
    // does NOT pre-populate this column, so a successful redirect here
    // should leave the row with a `cus_...` id.
    const orgRow = await tenant.db.execute({
      sql: `SELECT stripeCustomerId FROM "Org" WHERE id = ?`,
      args: [tenant.orgId],
    });
    const customerId = orgRow.rows[0]?.stripeCustomerId;
    expect(
      typeof customerId === "string" && customerId.startsWith("cus_"),
      `expected Org.stripeCustomerId to start with 'cus_' after checkout call, got: ${String(customerId)}`,
    ).toBe(true);
  });

  test("POST /api/billing/checkout requires an authed admin (anonymous → /login)", async ({
    request,
    tenant,
  }: {
    request: import("@playwright/test").APIRequestContext;
    tenant: SeededTenant;
  }) => {
    // No cookie header → user is unauthenticated. The action calls
    // `redirectWithError("/login", ...)` before any Stripe call, so this
    // case runs whether or not Stripe is configured.
    const url = tenant.tenantUrl("/api/billing/checkout");
    const response = await request.post(url, {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      data: "plan=CAR_LINE&billingCycle=monthly",
      maxRedirects: 0,
    });

    expect([302, 303]).toContain(response.status());
    const location = response.headers()["location"] ?? "";
    expect(location).toMatch(/\/login/);
    // Crucially: the redirect is NOT to checkout.stripe.com.
    expect(location).not.toMatch(/checkout\.stripe\.com/);
  });
});
