import { test, expect } from "@playwright/test";

test.describe("marketing site", () => {
  test("homepage loads with Pickup Roster nav link", async ({ page }) => {
    await page.goto("/");

    // MarketingNav renders a Link to "/" whose text reads "Pickup Roster"
    // (the word "Roster" is inside a <span>; combined accessible text is "Pickup Roster")
    await expect(
      page.getByRole("link", { name: "Pickup Roster" }).first()
    ).toBeVisible();
  });

  test("homepage footer has a Support mailto link", async ({ page }) => {
    await page.goto("/");
    // The site-wide Footer renders a "Support" link whose href is
    // mailto:<supportEmail>. We check both the visible anchor and the attribute.
    const supportLink = page.locator(
      'footer a[href^="mailto:support@pickuproster.com"]'
    );
    await expect(supportLink).toBeVisible();
    await expect(supportLink).toHaveAttribute(
      "href",
      /^mailto:support@pickuproster\.com/
    );
  });

  test("/pricing renders three plan cards", async ({ page }) => {
    await page.goto("/pricing");

    await expect(page.getByRole("heading", { name: "Car Line" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Campus" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "District" })).toBeVisible();
  });

  test("/pricing shows monthly prices by default", async ({ page }) => {
    await page.goto("/pricing");

    const carLineHeading = page.getByRole("heading", { name: /Car Line/i });
    await expect(carLineHeading).toBeVisible();
    await expect(page.getByText("$100").first()).toBeVisible();
    await expect(page.getByText("/ month").first()).toBeVisible();
  });

  test("/pricing links visitors into plan-specific signup", async ({
    page
  }) => {
    await page.goto("/pricing");

    const trialLinks = page.getByRole("link", { name: "Start Free Trial" });
    await expect(trialLinks.nth(0)).toHaveAttribute(
      "href",
      "/signup?plan=car-line"
    );
    await expect(trialLinks.nth(1)).toHaveAttribute(
      "href",
      "/signup?plan=campus"
    );
    await expect(trialLinks.nth(2)).toHaveAttribute(
      "href",
      "/signup?plan=district"
    );
  });

  test("/status is publicly reachable", async ({ page }) => {
    await page.goto("/status");
    await expect(
      page.getByRole("heading", { name: "Pickup Roster Status" })
    ).toBeVisible();
  });
});
