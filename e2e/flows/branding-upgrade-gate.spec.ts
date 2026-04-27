/**
 * branding-upgrade-gate critical path.
 *
 * Covers:
 *   1. FREE/CAR_LINE plan loads `/admin/branding` and sees:
 *      - The colors form (always available),
 *      - NO logo upload `<input>`,
 *      - NO custom-domain `<input>`,
 *      - The "Upgrade to Campus" upsell with a `<a href="/admin/billing">` link.
 *   2. FREE/CAR_LINE plan POST `/admin/branding` with a logo file + custom
 *      domain is rejected — the action runs the
 *      `planAllowsAdvancedBranding(billingPlan)` gate and returns a 400 with
 *      the `branding.errors.advancedRequired` string. The DB column
 *      `Org.customDomain` must NOT be updated, even on a crafted bypass.
 *   3. CAMPUS plan loads `/admin/branding` and sees the logo upload + custom
 *      domain inputs, with the upsell hidden.
 *
 * Why this matters:
 * The plan-limits helper (`app/lib/plan-limits.ts`) is unit-tested in
 * isolation. The route-level integration — loader exposes the right shape,
 * UI renders the right block, action enforces the same gate even on a
 * crafted multipart bypass — has no automated coverage today. A regression
 * (inverted boolean, dropped server-side check) would ship silently because
 * the smoke sweep only asserts a 200 + heading. See research spec at
 * `docs/nightly-specs/2026-04-26-interaction-tests-branding-gate.md`.
 *
 * Quality rule: if any assertion surfaces a real app bug, do NOT rewrite
 * the test to match the buggy behavior. Leave it as a hard failure or
 * `test.fixme(..., "<bug description>")` and flag it in the build summary.
 *
 * Tenant plan is set via the `tenantBillingPlan` fixture option, declared
 * in `e2e/fixtures/seeded-tenant.ts`. Each `describe` block scopes the
 * plan via `test.use({ tenantBillingPlan: ... })`.
 */
import { test, expect } from "../fixtures/seeded-tenant";

// Strings come from `public/locales/en/admin.json`. Tests run without an
// explicit locale cookie, which falls back to English in `i18n.server.ts`.
const ADVANCED_REQUIRED =
  "Custom domain and logo upload require the Campus or District plan.";
const ADVANCED_TITLE = "Logo upload & custom domain";
const UPGRADE_CTA = "Upgrade to Campus";
const LOGO_LABEL_RE = /Logo \(PNG, JPEG, WEBP/i;
const CUSTOM_DOMAIN_RE = /^Custom domain$/i;

// 8-byte PNG signature. Sufficient because the plan-gate fires BEFORE
// `validateLogoUpload` runs — the file body never reaches the validator
// in the bypass-reject path. Keeping the buffer hermetic avoids any
// dependency on a real test-fixture image.
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test.describe("@flow branding-upgrade-gate — FREE plan upsell", () => {
  // Use FREE explicitly even though CAR_LINE would also fail the gate;
  // this keeps the test honest to the queue copy ("FREE user sees upsell")
  // and proves the gate isn't accidentally CAR_LINE-only.
  test.use({ tenantBillingPlan: "FREE" });

  test("FREE plan: /admin/branding hides logo + custom-domain inputs and shows upsell", async ({
    page,
    tenant,
  }) => {
    await page.context().addCookies([tenant.adminCookie]);
    await page.goto(tenant.tenantUrl("/admin/branding"));

    // Page loaded — the colors form is always present regardless of plan.
    await expect(
      page.getByRole("heading", { name: /Branding/i }).first(),
    ).toBeVisible();

    // Advanced fields must be absent.
    await expect(page.getByLabel(LOGO_LABEL_RE)).toHaveCount(0);
    await expect(page.getByLabel(CUSTOM_DOMAIN_RE)).toHaveCount(0);

    // Upsell present with a link to billing.
    await expect(page.getByText(ADVANCED_TITLE)).toBeVisible();
    const upgradeLink = page.getByRole("link", { name: UPGRADE_CTA });
    await expect(upgradeLink).toBeVisible();
    await expect(upgradeLink).toHaveAttribute("href", "/admin/billing");
  });

  test("FREE plan: crafted multipart POST is rejected and customDomain stays unchanged", async ({
    page,
    tenant,
  }) => {
    await page.context().addCookies([tenant.adminCookie]);

    // page.request shares cookies with the browser context, so the auth
    // cookie added above flows through automatically.
    const response = await page.request.post(
      tenant.tenantUrl("/admin/branding"),
      {
        multipart: {
          // Action requires both color fields to pass server-side validation
          // even though they aren't the focus of this test.
          brandColor: "#112233",
          brandAccentColor: "#445566",
          // The crafted bypass: a logo file + custom domain. The server gate
          // at app/routes/admin/branding.tsx:84-93 must return 400.
          logo: {
            name: "evil.png",
            mimeType: "image/png",
            buffer: PNG_SIGNATURE,
          },
          customDomain: "evil.test",
        },
        // Don't auto-follow any 30x — we want to see exactly what the
        // action returned. (data({status: 400}) wouldn't redirect anyway,
        // but explicit is safer.)
        maxRedirects: 0,
      },
    );

    expect(response.status()).toBe(400);

    // The error string is part of the rendered page (React Router serializes
    // actionData into the document for hydration). We don't depend on the
    // visible DOM here — the upsell block doesn't render the inline error
    // node — but the string is guaranteed to be present in the response body.
    const body = await response.text();
    expect(body).toContain(ADVANCED_REQUIRED);

    // The action MUST NOT have written customDomain even though the bypass
    // included it. Confirm via the fixture's libsql handle.
    const row = await tenant.db.execute({
      sql: `SELECT customDomain FROM "Org" WHERE id = ?`,
      args: [tenant.orgId],
    });
    const customDomain = row.rows[0]?.customDomain ?? null;
    expect(customDomain == null || customDomain === "").toBe(true);
  });
});

test.describe("@flow branding-upgrade-gate — CAMPUS plan inputs", () => {
  test.use({ tenantBillingPlan: "CAMPUS" });

  test("CAMPUS plan: /admin/branding shows logo + custom-domain inputs and hides upsell", async ({
    page,
    tenant,
  }) => {
    await page.context().addCookies([tenant.adminCookie]);
    await page.goto(tenant.tenantUrl("/admin/branding"));

    // Page loaded.
    await expect(
      page.getByRole("heading", { name: /Branding/i }).first(),
    ).toBeVisible();

    // Advanced fields present.
    await expect(page.getByLabel(LOGO_LABEL_RE)).toBeVisible();
    await expect(page.getByLabel(CUSTOM_DOMAIN_RE)).toBeVisible();

    // Upsell hidden.
    await expect(page.getByText(ADVANCED_TITLE)).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: UPGRADE_CTA }),
    ).toHaveCount(0);
  });
});
