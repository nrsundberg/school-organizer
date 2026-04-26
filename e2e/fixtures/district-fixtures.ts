/**
 * District-flow Playwright fixture — drives /district/signup end-to-end
 * and yields a Page already authed as a district admin on /district.
 *
 * Each test gets a fresh district (slug + email stamped with Date.now())
 * so parallel runs don't collide.
 *
 * Unlike `seeded-tenant.ts`, this does not seed the DB directly — it
 * exercises the public signup flow so the test surface includes the
 * better-auth signup, district-create, and post-redirect routing
 * codepaths together.
 *
 * Hydration race note:
 * Several of the .fill() calls below are followed by a verification step
 * that re-fills the FIRST field if it's empty. Without that, this fixture
 * is flaky: Playwright's typing into the first input can race with React's
 * hydration pass — when hydration lands after the fill, React reconciles
 * the input back to its server-rendered (empty) value, the browser
 * blocks the submit on `required`, and the test stays on /district/signup.
 * The race only hits the first input because subsequent fills happen after
 * hydration is already done.
 */
import { test as base, expect, type Page } from "@playwright/test";

export type DistrictSession = {
  name: string;
  admin: { email: string; password: string };
};

/**
 * Fill a form field, but if it ends up empty (because React hydration
 * reset it after the .fill()), retry once. See the "Hydration race note"
 * in the file header for why this is necessary on the first input of
 * uncontrolled forms here.
 */
async function safeFill(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  const input = page.locator(selector);
  await input.fill(value);
  if ((await input.inputValue()) !== value) {
    await input.fill(value);
  }
}

export const test = base.extend<{
  district: DistrictSession;
  districtPage: Page;
}>({
  district: async ({}, use) => {
    const stamp = Date.now();
    const session: DistrictSession = {
      name: `Test District ${stamp}`,
      admin: {
        email: `district-${stamp}@example.test`,
        password: "Pa$$w0rd1234!",
      },
    };
    await use(session);
  },
  districtPage: async ({ page, district }, use) => {
    await page.goto("/district/signup");
    await expect(page.locator("[name=districtName]")).toBeVisible();
    await safeFill(page, "[name=districtName]", district.name);
    await safeFill(page, "[name=adminName]", "Test Admin");
    await safeFill(page, "[name=adminEmail]", district.admin.email);
    await safeFill(page, "[name=adminPassword]", district.admin.password);
    // One last guard: re-check the first field right before submitting.
    // If React only hydrated AFTER all the safeFill retries (rare, but
    // possible under CI load), the first field can still be empty here.
    const districtNameInput = page.locator("[name=districtName]");
    if ((await districtNameInput.inputValue()) === "") {
      await districtNameInput.fill(district.name);
    }
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/district$/);
    await use(page);
  },
});

export { expect, safeFill };
