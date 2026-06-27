/**
 * branding-upgrade-gate critical path.
 *
 * Covers the advanced-branding (logo upload) plan gate on /admin/branding:
 *   1. FREE plan loads `/admin/branding` and sees:
 *      - The colors form (always available),
 *      - NO logo upload `<input type="file">`,
 *      - The "Upgrade to Campus" upsell with a `<a href="/admin/billing">` link.
 *   2. FREE plan POST `/admin/branding` with a logo file is rejected by the
 *      server-side `planAllowsAdvancedBranding(billingPlan)` gate — the
 *      action returns WITHOUT redirecting to the success page and the
 *      logo is never persisted (`Org.logoObjectKey` stays null), even on a
 *      crafted multipart bypass.
 *   3. CAMPUS plan loads `/admin/branding` and sees the logo upload input,
 *      with the upsell hidden.
 *
 * Adapted from the original 2026-04-26 spec for current master:
 *   - Custom-domain editing was removed for tenants — the custom domain is
 *     now a read-only display set by platform staff only (see the
 *     doc-comment in app/routes/admin/branding.tsx). All custom-domain
 *     input/bypass assertions are therefore dropped.
 *   - The advanced gate now covers logo upload only; the error string is
 *     `branding.errors.advancedRequired` = "Logo upload requires the Campus
 *     or District plan." and the action returns via `dataWithError` (a
 *     toast, status 200 — not a 400 with the string in the body), so the
 *     bypass-reject assertion checks the persisted side-effect instead.
 *
 * Why this matters:
 * The plan-limits helper (app/lib/plan-limits.ts) is unit-tested in
 * isolation. The route-level integration — loader exposes the right shape,
 * UI renders the right block, action enforces the same gate even on a
 * crafted multipart bypass — has no automated coverage otherwise.
 *
 * Quality rule: if any assertion surfaces a real app bug, do NOT rewrite
 * the test to match the buggy behavior. Leave it as a hard failure or
 * `test.fixme(..., "<bug description>")` and flag it in the build summary.
 *
 * Tenant plan is set via the `tenantBillingPlan` fixture option, declared
 * in e2e/fixtures/seeded-tenant.ts. Each `describe` scopes the plan via
 * `test.use({ tenantBillingPlan: ... })`.
 */
import { test, expect } from "../fixtures/seeded-tenant";

// Strings come from public/locales/en/admin.json. Tests run without an
// explicit locale cookie, which falls back to English in i18n.server.ts.
const ADVANCED_TITLE = "Logo upload"; // branding.advancedTitle (upsell heading)
const UPGRADE_CTA = "Upgrade to Campus"; // branding.upgradeCampus
const LOGO_LABEL_RE = /Logo \(PNG, JPEG, WEBP/i; // branding.logoLabel

// 8-byte PNG signature. Sufficient because the plan-gate fires BEFORE
// validateLogoUpload runs — the file body never reaches the validator in
// the bypass-reject path. Keeping the buffer hermetic avoids any
// dependency on a real test-fixture image.
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test.describe("@flow branding-upgrade-gate — FREE plan upsell", () => {
  // Use FREE explicitly even though CAR_LINE would also fail the gate;
  // this keeps the test honest to the queue copy ("FREE user sees upsell")
  // and proves the gate isn't accidentally CAR_LINE-only.
  test.use({ tenantBillingPlan: "FREE" });

  test("FREE plan: /admin/branding hides the logo input and shows the upsell", async ({
    page,
    tenant,
  }) => {
    await page.context().addCookies([tenant.adminCookie]);
    await page.goto(tenant.tenantUrl("/admin/branding"));

    // Page loaded — the colors form is always present regardless of plan.
    await expect(
      page.getByRole("heading", { name: /Branding/i }).first(),
    ).toBeVisible();

    // Advanced (logo) field must be absent for FREE.
    await expect(page.getByLabel(LOGO_LABEL_RE)).toHaveCount(0);

    // Upsell present with a link to billing.
    await expect(
      page.getByText(ADVANCED_TITLE, { exact: true }),
    ).toBeVisible();
    const upgradeLink = page.getByRole("link", { name: UPGRADE_CTA });
    await expect(upgradeLink).toBeVisible();
    await expect(upgradeLink).toHaveAttribute("href", "/admin/billing");
  });

  test("FREE plan: crafted multipart logo POST is rejected and no logo is persisted", async ({
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
          // Action validates both color fields too, but the advanced gate
          // fires first, so these are only here to mirror a real submit.
          brandColor: "#112233",
          brandAccentColor: "#445566",
          // The crafted bypass: a logo file on a plan that may not upload.
          // The server gate (app/routes/admin/branding.tsx) must reject it.
          logo: {
            name: "evil.png",
            mimeType: "image/png",
            buffer: PNG_SIGNATURE,
          },
        },
        // Don't auto-follow any 30x — we want to see exactly what the
        // action returned. The gate returns dataWithError (a non-redirect
        // 200 toast); a *successful* save would 302 to /admin/branding.
        maxRedirects: 0,
      },
    );

    // Gate-blocked path does not redirect (success path uses
    // redirectWithSuccess → 302). Anything in the 3xx range would mean the
    // upload was accepted.
    expect(response.status(), "gate-blocked POST must not redirect").toBeLessThan(300);

    // The action MUST NOT have persisted a logo for a non-advanced plan.
    // Confirm via the fixture's libsql handle that Org.logoObjectKey is
    // still null/empty.
    const row = await tenant.db.execute({
      sql: `SELECT logoObjectKey FROM "Org" WHERE id = ?`,
      args: [tenant.orgId],
    });
    const logoObjectKey = row.rows[0]?.logoObjectKey ?? null;
    expect(logoObjectKey == null || logoObjectKey === "").toBe(true);
  });
});

test.describe("@flow branding-upgrade-gate — CAMPUS plan inputs", () => {
  test.use({ tenantBillingPlan: "CAMPUS" });

  test("CAMPUS plan: /admin/branding shows the logo input and hides the upsell", async ({
    page,
    tenant,
  }) => {
    await page.context().addCookies([tenant.adminCookie]);
    await page.goto(tenant.tenantUrl("/admin/branding"));

    // Page loaded.
    await expect(
      page.getByRole("heading", { name: /Branding/i }).first(),
    ).toBeVisible();

    // Advanced (logo) field present.
    await expect(page.getByLabel(LOGO_LABEL_RE)).toBeVisible();

    // Upsell hidden.
    await expect(page.getByText(ADVANCED_TITLE, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: UPGRADE_CTA }),
    ).toHaveCount(0);
  });
});
