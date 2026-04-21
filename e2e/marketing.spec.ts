import { test, expect } from "@playwright/test";

test.describe("marketing site", () => {
  test("homepage loads with Pickup Roster nav link", async ({ page }) => {
    await page.goto("/");

    // MarketingNav renders a Link to "/" whose text reads "Pickup Roster"
    // (the word "Roster" is inside a <span>; combined accessible text is "Pickup Roster")
    await expect(
      page.getByRole("link", { name: "Pickup Roster" }).first(),
    ).toBeVisible();
  });

  test("homepage footer has a Support mailto link", async ({ page }) => {
    await page.goto("/");
    // The site-wide Footer renders a "Support" link whose href is
    // mailto:<supportEmail>. We check both the visible anchor and the attribute.
    const supportLink = page.locator(
      'footer a[href^="mailto:support@pickuproster.com"]',
    );
    await expect(supportLink).toBeVisible();
    await expect(supportLink).toHaveAttribute(
      "href",
      /^mailto:support@pickuproster\.com/,
    );
  });

  test("/pricing renders three plan cards", async ({ page }) => {
    await page.goto("/pricing");

    await expect(page.getByRole("heading", { name: "Free trial" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Car Line" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Campus" })).toBeVisible();
  });

  test("/pricing shows monthly prices by default", async ({ page }) => {
    await page.goto("/pricing");

    // When monthly is active the cycle label "/mo" appears in Car Line and Campus card headings
    const carLineHeading = page.getByRole("heading", { name: /Car Line/i });
    await expect(carLineHeading).toBeVisible();
    await expect(page.getByText(/\/mo/).first()).toBeVisible();
  });

  test("/pricing monthly/annual toggle flips visible cycle label and signup href", async ({
    page,
  }) => {
    await page.goto("/pricing");

    // The toggle only renders when annualAvailable is true server-side
    // (STRIPE_*_ANNUAL_PRICE_ID set). Skip cleanly when annual isn't configured.
    const radiogroup = page.getByRole("radiogroup", { name: "Billing cycle" });
    const hasToggle = await radiogroup.isVisible().catch(() => false);

    if (!hasToggle) {
      test.skip();
      return;
    }

    // "2 months free" label lives inside the Annual button.
    await expect(page.getByText("2 months free")).toBeVisible();

    // Default state: "/mo" labels visible on plan cards.
    await expect(page.getByText(/\/mo/).first()).toBeVisible();

    // Click Annual. Use radio role to avoid any duplicate "Annual" text nodes.
    await page.getByRole("radio", { name: /Annual/i }).click();

    // Visible state flips: "/yr" appears, "/mo" no longer shown.
    await expect(page.getByText(/\/yr/).first()).toBeVisible();
    await expect(page.getByText(/\/mo/)).toHaveCount(0);

    // Unauthenticated visitors see "Sign up — Car Line/Campus" links whose
    // href carries the billing cycle forward as ?cycle=annual.
    const carLineSignup = page.getByRole("link", { name: /Sign up — Car Line/i });
    await expect(carLineSignup).toHaveAttribute("href", /cycle=annual/);
  });
});
