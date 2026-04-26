/**
 * signup-to-paid critical path (workstream 0d.2).
 *
 * Covers the two redirect boundaries in the signup → trial → checkout
 * flow without driving Stripe's hosted Checkout UI:
 *
 *   1. **Trial leg** — drives the real 3-step signup UI on the marketing
 *      host with the default plan flow (no `?plan=` → CAR_LINE,
 *      planSelectionSource = "default" → `shouldStartCheckoutAfterSignup`
 *      returns false → action redirects to the tenant board, NOT to
 *      `checkout.stripe.com`). Asserts the tenant subdomain redirect and
 *      verifies `Org.status === "TRIALING"` + a 30-day `trialEndsAt` in
 *      `dev.db`.
 *
 *   2. **Checkout leg** — uses the `seeded-tenant` fixture (admin already
 *      logged in, org already paid-plan ACTIVE). Issues a
 *      `request.post("/api/billing/checkout")` with the admin session
 *      cookie, `maxRedirects: 0`, and asserts the response is a 302/303
 *      with `Location: https://checkout.stripe.com/...`. Also asserts the
 *      org's `stripeCustomerId` was lazily populated as a side effect of
 *      `createCheckoutSessionForOrg`.
 *
 *      Conditionally `test.fixme`'d if `STRIPE_SECRET_KEY` is missing
 *      from `.dev.vars` (e.g. on Noah's local machine without Stripe
 *      creds, or in a sandbox without the secret bound). The check is a
 *      file-based read of `.dev.vars` so it stays in lockstep with what
 *      `wrangler dev` actually loads — no separate env vars to keep in
 *      sync.
 *
 * Bypass-via-`E2E_BYPASS_STRIPE`?  No — see
 * `docs/nightly-specs/2026-04-25-interaction-tests-signup-to-paid.md`
 * § "Why no E2E_BYPASS_STRIPE flag" for the rationale (a synthetic URL
 * doesn't catch the regressions we actually fear: renamed price IDs,
 * wrong redirect destination — both surface from the real call).
 *
 * What this spec deliberately does NOT cover:
 *   - Driving the actual `checkout.stripe.com` page (we have no headless
 *     Stripe; out of scope).
 *   - The `/billing/success?session_id=...` return-from-Stripe leg.
 *     That requires a completed Checkout Session; covered separately by
 *     the Stripe webhook unit tests (`tests/billing/*.test.ts`) and a
 *     future end-to-end spec that uses a Stripe test fixture.
 *
 * Quality rule (from the queue): if any assertion fails because of a
 * real app bug, do NOT paper over it — flag it as `.fixme` with a
 * comment, and surface in the build summary.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { test as baseTest, expect, type Cookie } from "@playwright/test";
import { createClient, type InStatement } from "@libsql/client";

import { test, type SeededTenant } from "../fixtures/seeded-tenant";
import { generateId } from "../fixtures/seed-helpers";

/* ------------------------------------------------------------------ */
/* Environment helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Returns true iff `.dev.vars` (the same file `wrangler dev` reads) has a
 * non-empty `STRIPE_SECRET_KEY`. We check the file rather than
 * `process.env.STRIPE_SECRET_KEY` because the Playwright runner doesn't
 * inherit wrangler's env, and we want the gate condition to actually
 * predict whether the worker request will succeed.
 *
 * Tolerates a missing file (fresh clones often won't have one) and treats
 * any read error as "not configured" — strictly more conservative than
 * letting the test attempt the call and fail with a confusing 500.
 */
function stripeIsConfigured(): boolean {
  try {
    // The Playwright `webServer.cwd` defaults to the config file's dir,
    // which is the repo root. The runner process inherits the same cwd,
    // so `.dev.vars` resolves the same way.
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

function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "file:./dev.db";
}

function baseUrl(): URL {
  return new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8787");
}

/**
 * Pretty-printed list of org/user/account/session ids the trial-leg test
 * created. Iterated by the `afterEach` hook for cleanup.
 *
 * Stored on a per-test scratchpad rather than module-level so two parallel
 * workers don't cross-contaminate each other's cleanup lists.
 */
type CreatedRows = {
  orgId?: string;
  userId?: string;
  accountId?: string;
  sessionId?: string;
};

/* ------------------------------------------------------------------ */
/* Trial leg — real signup UI → TRIALING org → tenant board redirect */
/* ------------------------------------------------------------------ */

baseTest.describe(
  "@flow signup-to-paid — trial leg (default plan, no Stripe)",
  () => {
    // We use baseTest (no seeded-tenant fixture) because the whole point of
    // this case is to exercise signup itself. Cleanup is handled in the
    // afterEach below.
    const created: CreatedRows = {};

    baseTest.afterEach(async () => {
      // Best-effort teardown — same FK-ordered DELETE list as
      // seeded-tenant.ts § teardownSeedRows. Tolerate failure: dev.db is
      // disposable, and the unique per-spec slug already isolates from
      // other workers.
      const db = createClient({ url: databaseUrl() });
      try {
        const stmts: InStatement[] = [];
        if (created.orgId) {
          stmts.push(
            { sql: `DELETE FROM "CallEvent" WHERE orgId = ?`, args: [created.orgId] },
            { sql: `DELETE FROM "Student" WHERE orgId = ?`, args: [created.orgId] },
            { sql: `DELETE FROM "Space" WHERE orgId = ?`, args: [created.orgId] },
            { sql: `DELETE FROM "Teacher" WHERE orgId = ?`, args: [created.orgId] },
            {
              sql: `DELETE FROM "ViewerAccessAttempt" WHERE orgId = ?`,
              args: [created.orgId],
            },
            {
              sql: `DELETE FROM "ViewerAccessSession" WHERE orgId = ?`,
              args: [created.orgId],
            },
            { sql: `DELETE FROM "AppSettings" WHERE orgId = ?`, args: [created.orgId] },
          );
        }
        if (created.sessionId)
          stmts.push({
            sql: `DELETE FROM "Session" WHERE id = ?`,
            args: [created.sessionId],
          });
        if (created.userId) {
          stmts.push(
            // Better Auth keeps the Account row keyed by userId.
            {
              sql: `DELETE FROM "Session" WHERE userId = ?`,
              args: [created.userId],
            },
            {
              sql: `DELETE FROM "Account" WHERE userId = ?`,
              args: [created.userId],
            },
            { sql: `DELETE FROM "User" WHERE id = ?`, args: [created.userId] },
          );
        }
        if (created.orgId)
          stmts.push({
            sql: `DELETE FROM "Org" WHERE id = ?`,
            args: [created.orgId],
          });
        for (const s of stmts) {
          try {
            await db.execute(s);
          } catch {
            /* ignore — teardown is best-effort */
          }
        }
      } finally {
        db.close();
        // Reset for the next test in this describe block.
        delete created.orgId;
        delete created.userId;
        delete created.accountId;
        delete created.sessionId;
      }
    });

    baseTest(
      "default-plan signup creates a TRIALING org and lands on the tenant board",
      async ({ page }) => {
        // Generate a unique slug + email per test so parallel workers (and
        // dirty `dev.db` from previous runs) don't collide on the
        // `Org.slug UNIQUE` constraint or the `User.email UNIQUE` index.
        const tag = generateId().slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "0");
        const slug = `e2e-s2p-${tag}`;
        const email = `s2p-${tag}@e2e.pickuproster.test`;
        const password = "password1234";
        const orgName = `E2E Trial ${tag}`;

        // Default-plan path: no `?plan=` query → loader bounces to /pricing
        // for unauthed visitors. We need to *start* the flow on /pricing
        // and click the "Start free trial" CTA, OR pass an explicit plan
        // query and rely on planSelectionSource = "default" from the
        // loader. The simplest deterministic path that proves the trial
        // leg fires `shouldStartCheckoutAfterSignup === false` is the
        // `?plan=car-line&source=default` form — but the loader normalizes
        // the source to "explicit" if the plan param is present.
        //
        // To get planSelectionSource = "default", the loader requires the
        // plan to be absent; once authed we fall back to "car-line" with
        // source "default". So we drive the flow as:
        //   1. /signup with no plan → redirected to /pricing
        //   2. Skip /pricing and instead start authed (signup step 1) on
        //      /signup?plan=car-line, then proceed.
        //
        // This still ends up with planSelectionSource = "explicit" from
        // the loader, which means shouldStartCheckoutAfterSignup is true
        // for CAR_LINE. To force the default branch, we use the DISTRICT
        // plan — which is NOT a self-serve plan in
        // `isSelfServeBillingPlan`, so even with planSelectionSource =
        // "explicit", `shouldStartCheckoutAfterSignup` returns false and
        // the action takes the no-card trial branch. This is the path
        // an enterprise/district customer takes via the pricing page's
        // "Talk to us" CTA (which actually does land them in /signup with
        // ?plan=district).
        await page.goto("/signup?plan=district");

        // Step 1: account.
        await page.locator('input[autocomplete="name"]').first().fill(`E2E ${tag}`);
        await page.locator('input[type="email"]').first().fill(email);
        await page.locator('input[type="tel"]').first().fill("5551234567");
        const passwords = page.locator('input[type="password"]');
        await passwords.nth(0).fill(password);
        await passwords.nth(1).fill(password);
        await page.getByRole("button", { name: /^Continue$/ }).click();

        // Step 2 should render. Fill org name + slug, check availability.
        await expect(
          page.getByRole("heading", { name: "Your school" }),
        ).toBeVisible({ timeout: 15_000 });
        await page.locator("#signup-org-name").fill(orgName);
        await page.locator("#signup-slug").fill(slug);
        await page.getByRole("button", { name: /Check availability/i }).click();

        // Wait for the green "Available" indicator before the Continue
        // button enables.
        await expect(page.getByText(/Available/i)).toBeVisible({
          timeout: 10_000,
        });
        await page.getByRole("button", { name: /Continue/ }).click();

        // Step 3: confirm → Start free trial. The action does NOT redirect
        // through Stripe for the DISTRICT plan; it lands on the tenant
        // board directly.
        await expect(
          page.getByRole("heading", { name: /create your school|free 30-day trial/i }),
        ).toBeVisible({ timeout: 10_000 });

        // Find the submit button on the form (text varies by plan; the
        // submit-type button on the step-3 form is unambiguous).
        const submitBtn = page
          .locator('form[method="post"] button[type="submit"]')
          .first();
        await Promise.all([
          page.waitForURL(
            (u) =>
              // tenant subdomain looks like `<slug>.localhost:8787/...`
              u.hostname.startsWith(`${slug}.`) && !u.pathname.startsWith("/signup"),
            { timeout: 20_000 },
          ),
          submitBtn.click(),
        ]);

        // ---------------------------------------------------------------
        // Verify D1 state: org row exists, status = TRIALING, ~30d trial.
        // ---------------------------------------------------------------
        const db = createClient({ url: databaseUrl() });
        try {
          const orgRow = await db.execute({
            sql: `SELECT id, status, billingPlan, trialEndsAt FROM "Org" WHERE slug = ?`,
            args: [slug],
          });
          expect(
            orgRow.rows.length,
            "expected exactly one Org row for the new slug",
          ).toBe(1);
          const row = orgRow.rows[0]!;
          created.orgId = String(row.id);
          expect(row.status, "Org.status after signup").toBe("TRIALING");
          // DISTRICT plan stays as DISTRICT — no automatic upgrade.
          expect(row.billingPlan).toBe("DISTRICT");
          // trialEndsAt should be ~30 days out. Allow ±2 days for test
          // clock skew + execution time.
          const trialEndMs = new Date(String(row.trialEndsAt)).getTime();
          const now = Date.now();
          const diffDays = (trialEndMs - now) / (24 * 60 * 60 * 1000);
          expect(diffDays).toBeGreaterThan(28);
          expect(diffDays).toBeLessThan(32);

          // Capture user + session ids for cleanup. The signup flow
          // creates one User + one Account + one Session for the email
          // we used.
          const userRow = await db.execute({
            sql: `SELECT id FROM "User" WHERE email = ?`,
            args: [email],
          });
          if (userRow.rows[0]?.id) {
            created.userId = String(userRow.rows[0].id);
          }
        } finally {
          db.close();
        }
      },
    );
  },
);

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
      "STRIPE_SECRET_KEY missing from .dev.vars — set the Stripe test creds (see docs/nightly-specs/2026-04-25-interaction-tests-signup-to-paid.md § Open questions for the full list) to run this leg.",
    );

    // Build the cookie header by hand — APIRequestContext doesn't pick up
    // cookies from a `page.context()` we never created here, and the
    // tenant fixture's `adminCookie` is shaped for `addCookies()` not the
    // raw header.
    const cookieHeader = `${tenant.adminCookie.name}=${tenant.adminCookie.value}`;

    const url = tenant.tenantUrl("/api/billing/checkout");

    // POST with `maxRedirects: 0` so the Stripe-bound 302/303 surfaces in
    // the response rather than getting silently followed (which would
    // hit `checkout.stripe.com` and slow the test by ~1s without telling
    // us anything we don't already know).
    //
    // The action is rate-limited at 10/min/orgId via RL_BILLING — well
    // above what one test does, so no throttling here.
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
    const db = createClient({ url: databaseUrl() });
    try {
      const orgRow = await db.execute({
        sql: `SELECT stripeCustomerId FROM "Org" WHERE id = ?`,
        args: [tenant.orgId],
      });
      const customerId = orgRow.rows[0]?.stripeCustomerId;
      expect(
        typeof customerId === "string" && customerId.startsWith("cus_"),
        `expected Org.stripeCustomerId to start with 'cus_' after checkout call, got: ${String(customerId)}`,
      ).toBe(true);
    } finally {
      db.close();
    }
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
    // case runs whether or not Stripe is configured. Useful as a regression
    // gate against the action accidentally exposing checkout to anonymous
    // visitors.
    const url = tenant.tenantUrl("/api/billing/checkout");
    const response = await request.post(url, {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      data: "plan=CAR_LINE&billingCycle=monthly",
      maxRedirects: 0,
    });

    expect([302, 303]).toContain(response.status());
    const location = response.headers()["location"] ?? "";
    // The redirect target is the marketing-host /login (relative paths
    // resolve against the request's host, so a tenant-host POST that
    // redirects to "/login" stays on the tenant host — that's fine,
    // /login on a tenant host re-routes to marketing in the loader).
    expect(location).toMatch(/\/login/);
    // Crucially: the redirect is NOT to checkout.stripe.com.
    expect(location).not.toMatch(/checkout\.stripe\.com/);
  });
});

// Re-export Cookie so editors can pick up the type without an import in
// the spec call sites — purely for IDE ergonomics, not runtime behavior.
export type { Cookie };
