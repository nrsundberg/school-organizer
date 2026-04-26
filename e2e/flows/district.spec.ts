import { test, expect, safeFill } from "../fixtures/district-fixtures";

test.describe("district portal", () => {
  test("signup -> create school -> appears in schools list", async ({
    districtPage,
  }) => {
    // After districtPage fixture runs we're already on /district. The
    // dashboard renders an empty-state CTA inside the schools table.
    await districtPage.goto("/district/schools");
    await expect(
      districtPage.getByRole("heading", { name: /Schools/ }),
    ).toBeVisible();

    await districtPage.click("text=Add school");
    await expect(districtPage).toHaveURL(/\/district\/schools\/new$/);

    const stamp = Date.now();
    await expect(districtPage.locator("[name=schoolName]")).toBeVisible();
    await safeFill(districtPage, "[name=schoolName]", "Central Elementary");
    await safeFill(districtPage, "[name=schoolSlug]", `central-${stamp}`);
    await safeFill(districtPage, "[name=adminName]", "School Admin");
    await safeFill(
      districtPage,
      "[name=adminEmail]",
      `school-${stamp}@example.test`,
    );
    await districtPage.click("button:has-text('Create school')");
    await expect(districtPage).toHaveURL(/\/district\/schools$/);
    await expect(
      districtPage.locator("td", { hasText: "Central Elementary" }),
    ).toBeVisible();
  });

  test("soft cap exceeded shows banner", async ({ districtPage }) => {
    // Default cap is 3. Create 4 schools and expect the over-cap banner
    // on the schools index.
    for (let i = 0; i < 4; i++) {
      const stamp = `${Date.now()}-${i}`;
      await districtPage.goto("/district/schools/new");
      await expect(districtPage.locator("[name=schoolName]")).toBeVisible();
      await safeFill(districtPage, "[name=schoolName]", `Cap School ${i}`);
      await safeFill(districtPage, "[name=schoolSlug]", `cap-${stamp}`);
      await safeFill(districtPage, "[name=adminName]", `Cap Admin ${i}`);
      await safeFill(
        districtPage,
        "[name=adminEmail]",
        `cap-${stamp}@example.test`,
      );
      await districtPage.click("button:has-text('Create school')");
      await expect(districtPage).toHaveURL(/\/district\/schools$/);
    }
    await expect(
      districtPage.getByText(/over your contracted school cap/),
    ).toBeVisible();

    // Audit log captures the cap exceeded event.
    await districtPage.goto("/district/audit");
    await expect(
      districtPage.locator("td", { hasText: "district.school.cap.exceeded" }),
    ).toBeVisible();
  });
});
