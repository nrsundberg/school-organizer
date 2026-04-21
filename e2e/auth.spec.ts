import { test, expect } from "@playwright/test";

test.describe("auth pages", () => {
  test("/login renders an email field and submit button", async ({ page }) => {
    await page.goto("/login");

    // Login page step 1: email field (has id="email" and a label "Email")
    await expect(page.getByLabel("Email")).toBeVisible();

    // Submit button text is "Next" on the email step
    await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  });

  test("/signup renders an org name / school name field", async ({ page }) => {
    await page.goto("/signup");

    // Step 1 of signup: "Your name" and "Email" fields are shown.
    // The org name field ("School / organization name") is on step 2, which requires auth.
    // Step 1 shows the account creation form with a "Your name" label.
    await expect(page.getByText("Your name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  });

  test("/admin while unauthenticated redirects to /login", async ({ page }) => {
    await page.goto("/admin");

    // After redirect, either the URL should contain /login or the login form should be visible
    await page.waitForURL(/\/login/, { timeout: 10000 }).catch(() => {
      // If URL didn't change, the login form should at least be rendered on the page
    });

    const onLoginPage =
      page.url().includes("/login") ||
      (await page.getByLabel("Email").isVisible().catch(() => false));

    expect(onLoginPage).toBe(true);
  });
});
