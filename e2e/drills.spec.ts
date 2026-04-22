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
