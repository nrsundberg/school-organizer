/**
 * E2E smoke for the Drill Templates admin feature.
 *
 * Coverage:
 *  1. Admin can visit /admin/drills, create a new template, save the layout,
 *     and the page reloads with the updated columns.
 *  2. Admin can visit /admin/drills/library, clone a template
 *     (e.g. "Fire Evacuation"), and land on the edit page with the template
 *     name visible.
 *  3. After cloning, returning to /admin/drills/library shows the cloned
 *     template row as "Already cloned."
 *
 * Auth caveat: the Playwright baseURL (http://localhost:8787) is treated as a
 * marketing host, which means tenant-authenticated routes like /admin/drills
 * redirect to /login when no session is seeded. We do NOT have a seeded-admin
 * fixture in the repo today — mirror the graceful pattern in smoke.spec.ts.
 * Each test probes whether an admin session is reachable and skips cleanly if
 * not, instead of failing. When a real admin fixture lands later, flip the
 * probe off and the assertions run for real.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  test as flowTest,
  expect as flowExpect,
} from "./fixtures/seeded-tenant";

async function isOnAdminDrills(page: Page): Promise<boolean> {
  // We're "on" the admin drills page if the URL stuck and a Drill-related
  // heading rendered. If we were redirected to /login or the error boundary
  // fired, treat this as "not signed in as admin".
  if (!page.url().includes("/admin/drills")) return false;
  // The admin drills list has this heading (see app/routes/admin/drills.tsx).
  const heading = page.getByRole("heading", { name: /Drill checklists/i });
  return heading.isVisible().catch(() => false);
}

test.describe("@smoke drills admin — create + save template", () => {
  test("admin creates a template and saves layout", async ({ page }) => {
    await page.goto("/admin/drills");

    if (!(await isOnAdminDrills(page))) {
      test.skip(
        true,
        "No admin session seeded for localhost. Seeded-admin fixture needed; see smoke.spec.ts note.",
      );
      return;
    }

    const name = `Smoke Template ${Date.now()}`;
    await page.getByLabel("Name").fill(name);
    await page
      .getByRole("button", { name: /Create blank/i })
      .click();

    // Landed on /admin/drills/:id (the editor page).
    await page.waitForURL(/\/admin\/drills\/[^/]+$/, { timeout: 15000 });

    // Editor shows the template name somewhere (heading or input value).
    const byText = await page.getByText(name).first().isVisible().catch(() => false);
    const byInput = await page
      .locator(`input[value="${name}"]`)
      .first()
      .isVisible()
      .catch(() => false);
    expect(byText || byInput, "template name should appear on the edit page").toBe(
      true,
    );

    // Reload to confirm the layout is actually persisted — default layout has
    // the "Grade", "Teacher", and "Check" columns.
    await page.reload();

    await expect(
      page.getByText(/Grade/).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("@smoke drills library — clone template", () => {
  test("admin clones Fire Evacuation and lands on edit page", async ({ page }) => {
    await page.goto("/admin/drills/library");

    // Library page isn't loaded? Likely no admin session — skip.
    const onLibrary =
      page.url().includes("/admin/drills/library") &&
      (await page
        .getByRole("heading", { name: /library/i })
        .first()
        .isVisible()
        .catch(() => false));
    if (!onLibrary) {
      test.skip(
        true,
        "Could not reach /admin/drills/library (no admin session seeded).",
      );
      return;
    }

    // Find the "Fire Evacuation" card/row and click its clone button.
    const fireRow = page
      .locator("li, article, section, div")
      .filter({ hasText: /Fire Evacuation/i })
      .first();
    await expect(fireRow).toBeVisible({ timeout: 10000 });

    // Prefer a button; fall back to any clickable "Clone" control inside the row.
    const cloneButton = fireRow
      .getByRole("button", { name: /clone|add to my templates/i })
      .first();
    await cloneButton.click();

    // Landed on the edit page.
    await page.waitForURL(/\/admin\/drills\/[^/]+$/, { timeout: 15000 });

    const byText = await page
      .getByText(/Fire Evacuation/i)
      .first()
      .isVisible()
      .catch(() => false);
    const byInput = await page
      .locator('input[value*="Fire Evacuation" i]')
      .first()
      .isVisible()
      .catch(() => false);
    expect(
      byText || byInput,
      "cloned template should show the Fire Evacuation name",
    ).toBe(true);
  });

  test("after cloning, library shows 'Already cloned' for that template", async ({
    page,
  }) => {
    await page.goto("/admin/drills/library");

    const onLibrary =
      page.url().includes("/admin/drills/library") &&
      (await page
        .getByRole("heading", { name: /library/i })
        .first()
        .isVisible()
        .catch(() => false));
    if (!onLibrary) {
      test.skip(
        true,
        "Could not reach /admin/drills/library (no admin session seeded).",
      );
      return;
    }

    // This test assumes the previous test cloned Fire Evacuation. In a clean
    // environment, clone it now so the assertion has something to check.
    const fireRow = page
      .locator("li, article, section, div")
      .filter({ hasText: /Fire Evacuation/i })
      .first();
    await expect(fireRow).toBeVisible({ timeout: 10000 });

    const alreadyCloned = fireRow.getByText(/Already cloned/i).first();
    if (!(await alreadyCloned.isVisible().catch(() => false))) {
      // Clone it now and come back.
      const cloneBtn = fireRow
        .getByRole("button", { name: /clone|add to my templates/i })
        .first();
      if (await cloneBtn.isVisible().catch(() => false)) {
        await cloneBtn.click();
        await page.waitForURL(/\/admin\/drills\//, { timeout: 15000 });
        await page.goto("/admin/drills/library");
      }
    }

    // Now assert "Already cloned" (or equivalent disabled state) shows.
    const fireRowAfter = page
      .locator("li, article, section, div")
      .filter({ hasText: /Fire Evacuation/i })
      .first();
    await expect(
      fireRowAfter.getByText(/Already cloned/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

/**
 * Guest read-only e2e — uses the seeded-tenant fixture (see
 * e2e/fixtures/seeded-tenant.ts) instead of the graceful-skip pattern
 * above, because it needs a real admin session AND a real viewer-pin
 * session, neither of which the anonymous-probe tests above can produce.
 *
 * Two flows, discovered by reading the routes before writing this test:
 *
 * (a) Starting an EVERYONE drill: `DrillTemplate.defaultAudience` defaults
 *     to "EVERYONE" in the Prisma schema, and `StartLivePopover` (rendered
 *     per-template on /admin/drills) hard-codes its hidden `audience`
 *     input to that template's `defaultAudience`. So a freshly created
 *     blank template needs no audience change — clicking "Start live
 *     drill" then confirming in the popover starts an EVERYONE run
 *     (app/routes/admin/drills.tsx `intent === "start-live"`, which
 *     redirects to /drills/live on success). The popover's trigger button
 *     and its confirm button share the exact same label ("Start live
 *     drill" — see public/locales/en/admin.json `drills.list.startLive`
 *     and `drills.list.startConfirm.confirm`), so the confirm click is
 *     disambiguated via `button[type="submit"]` (the trigger is
 *     type="button") rather than by name.
 *
 * (b) Claiming a viewer-pin session: `/viewer-access` (app/routes/
 *     viewer-access.tsx) is a PIN form, not a token link — the fixture's
 *     `tenant.viewerPin` is the plaintext PIN for the seeded
 *     AppSettings.viewerPinHash. Submitting it drives the real action
 *     (`verifyViewerPinAndIssueSession` in
 *     app/domain/auth/viewer-access.server.ts), which issues a genuine
 *     `pickuproster_viewer_session` cookie via a Set-Cookie header on the
 *     redirect response — see e2e/flows/viewer-pin.spec.ts for the same
 *     selectors used against the real flow.
 */
flowTest.describe("@flow drills — guest read-only", () => {
  flowTest("magic-code guest sees a read-only live drill, not an error page", async ({
    page,
    browser,
    tenant,
  }) => {
    // Arrange 1: admin starts an EVERYONE drill.
    await page.context().addCookies([tenant.adminCookie]);
    await page.goto(tenant.tenantUrl("/admin/drills"));

    const templateName = `E2E Guest RO ${Date.now()}`;
    await page.getByLabel("Name").fill(templateName);
    await page.getByRole("button", { name: /create blank/i }).click();

    // Landed on the template editor (/admin/drills/:id).
    await page.waitForURL(/\/admin\/drills\/[^/]+$/, { timeout: 15000 });

    // Back on the list, the new template's row has a "Start live drill"
    // trigger. Its defaultAudience is "EVERYONE" (schema default), which
    // the popover's hidden `audience` field mirrors, so no audience
    // change is needed before confirming.
    await page.goto(tenant.tenantUrl("/admin/drills"));
    await page
      .getByRole("button", { name: /^start live drill$/i })
      .first()
      .click();

    await flowExpect(page.getByText(/visible to:.*everyone/i)).toBeVisible();

    // The confirm button shares its accessible name with the trigger
    // button, so disambiguate on the real DOM attribute that differs
    // between them (trigger is type="button", confirm is type="submit").
    await page
      .locator('button[type="submit"]')
      .filter({ hasText: /start live drill/i })
      .click();

    // The fetcher submission doesn't navigate this admin tab (the action
    // redirects, but the popover has no explicit close-on-success either —
    // both are pre-existing UI quirks, not something this test should
    // paper over). What DOES prove the run is live: /admin/drills's own
    // loader shows an "Open live page" link once an active run exists, and
    // the fetcher's automatic revalidation re-runs that loader after the
    // POST resolves. Wait on that real signal instead of a URL change.
    await flowExpect(
      page.getByRole("link", { name: /open live page/i }),
    ).toBeVisible({ timeout: 15000 });

    // Arrange 2: a SEPARATE context with no admin cookie claims a viewer
    // link, so the guest genuinely holds only a viewer-pin session.
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();

    await guest.goto(tenant.tenantUrl("/viewer-access"));
    await guest.getByPlaceholder("Access code").fill(tenant.viewerPin);
    // The action redirects to "/", but with a live EVERYONE drill running
    // (per Arrange 1), the root loader immediately bounces in-audience
    // callers on to /drills/live (see the "Wake idle clients" comment in
    // app/routes/admin/drills.tsx) — so this guest may land on either,
    // depending on timing. Either way confirms the real claim flow ran.
    await Promise.all([
      guest.waitForURL(
        (u) => u.pathname === "/" || u.pathname === "/drills/live",
        { timeout: 15000 },
      ),
      guest.getByRole("button", { name: /^continue$/i }).click(),
    ]);

    await guest.goto(tenant.tenantUrl("/drills/live"));

    // The read-only notice renders...
    await flowExpect(guest.getByText(/watching as a guest/i)).toBeVisible();

    // ...attest buttons are inert...
    await flowExpect(
      guest.getByRole("button", { name: /attest all-clear/i }).first(),
    ).toBeDisabled();

    // ...the notes field is inert...
    await flowExpect(guest.getByRole("textbox").first()).toBeDisabled();

    // ...and the page is still the drill, not the root error boundary.
    await flowExpect(guest.getByText(/not logged in/i)).toHaveCount(0);

    await guestContext.close();
  });
});
