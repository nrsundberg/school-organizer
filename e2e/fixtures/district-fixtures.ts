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
 */
import { test as base, expect, type Page } from "@playwright/test";

export type DistrictSession = {
  name: string;
  admin: { email: string; password: string };
};

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
    await page.fill("[name=districtName]", district.name);
    await page.fill("[name=adminName]", "Test Admin");
    await page.fill("[name=adminEmail]", district.admin.email);
    await page.fill("[name=adminPassword]", district.admin.password);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/district$/);
    await use(page);
  },
});

export { expect };
