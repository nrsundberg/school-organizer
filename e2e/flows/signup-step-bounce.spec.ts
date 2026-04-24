/**
 * Regression test for the P0 signup step-1 → step-2 bounce-back bug
 * (scan 2026-04-23-2317).
 *
 * Symptom: After filling step 1 (name/email/phone/password) and clicking
 * "Continue", `POST /api/auth/sign-up/email` succeeds (200) and the URL
 * briefly updates to `?step=2`, but the UI immediately navigates back to
 * `?step=1`. The step-2 "Your school" heading is never rendered and no
 * inline error is shown — for the end user, "Continue" appears to do
 * nothing.
 *
 * Root cause: The `useEffect` in `app/routes/auth/signup.tsx` that
 * enforces "step 2/3 requires auth" reads `isAuthed` from the root
 * loader (`useRouteLoaderData("root").user`). After `signUp.email()`
 * resolves, React Router revalidates the signup route's loader, but the
 * root loader is NOT revalidated — so `rootData.user` is still `null`
 * when the bounce-back effect runs, and it kicks the user back to
 * step 1.
 *
 * Fix: after `signUp.email()` resolves, set a local `justSignedUp` flag
 * that short-circuits the bounce-back effect AND call
 * `revalidator.revalidate()` so the root loader actually refetches.
 */
import { test, expect } from "@playwright/test";

const uniqueEmail = () =>
  `signup-bounce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.pickuproster.com`;

test.describe("signup step-1 → step-2 transition", () => {
  test("filling step 1 and clicking Continue advances to step 2 (no bounce-back)", async ({
    page,
  }) => {
    const email = uniqueEmail();

    await page.goto("/signup?plan=car-line");

    // Fill step 1. Inputs are identified by autocomplete/type rather than
    // labels because the HeroUI Input component wraps labels in a way that
    // `getByLabel` is flaky against.
    await page.locator('input[autocomplete="name"]').first().fill("Bounce Test");
    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="tel"]').first().fill("5551234567");
    const passwords = page.locator('input[type="password"]');
    await passwords.nth(0).fill("password1234");
    await passwords.nth(1).fill("password1234");

    await page.getByRole("button", { name: /^Continue$/ }).click();

    // Step 2 should render: heading "Your school" + org-name input. If the
    // bounce-back bug is present, we will still be on step 1 and this will
    // time out.
    await expect(
      page.getByRole("heading", { name: "Your school" }),
    ).toBeVisible({ timeout: 15_000 });

    // The URL should reflect step 2 and preserve the plan query.
    await expect(page).toHaveURL(/[?&]step=2(\b|&)/);
    await expect(page).toHaveURL(/[?&]plan=car-line(\b|&)/);
  });
});
