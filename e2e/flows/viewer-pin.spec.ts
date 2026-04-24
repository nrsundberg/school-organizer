/**
 * viewer-pin critical path.
 *
 * Covers:
 *   1. Correct PIN issues a `tome_viewer_session` cookie and lands the
 *      visitor on the tenant root.
 *   2. Wrong PIN returns an error message without issuing the cookie.
 *   3. Repeated wrong PINs tick the "attempts left" counter — verifying
 *      the lockout logic in `app/domain/auth/viewer-access.server.ts`
 *      is actually wired up end-to-end. We do NOT drive the full
 *      4-attempt lockout in this spec because the per-fingerprint
 *      ViewerAccessAttempt rows would persist in dev.db beyond the
 *      test and the RL Durable Object state survives across specs.
 *      A dedicated "full lockout" spec can be added once the fixture
 *      grows explicit cleanup for ViewerAccessAttempt.
 *
 * See docs/nightly-specs/2026-04-23-interaction-tests-critical-paths.md
 * §"Open questions" #4 for the lockout-reset tradeoff discussion.
 */
import { test, expect } from "../fixtures/seeded-tenant";

const VIEWER_SESSION_COOKIE = "tome_viewer_session";

test.describe("@flow viewer-pin — access code gate", () => {
  test("correct PIN issues viewer-session cookie and redirects to /", async ({ page, tenant }) => {
    await page.goto(tenant.tenantUrl("/viewer-access"));
    await expect(page.getByRole("heading", { name: /Private Viewer Access/i })).toBeVisible();

    await page.getByPlaceholder("Access code").fill(tenant.viewerPin);
    await Promise.all([
      page.waitForURL((u) => u.pathname === "/"),
      page.getByRole("button", { name: /^Continue$/ }).click(),
    ]);

    // Verify the viewer-session cookie got set. Better Auth's cookie
    // is tome.session_token; this is the separate viewer-access cookie
    // defined in app/domain/auth/viewer-access.server.ts.
    const cookies = await page.context().cookies();
    const viewerSession = cookies.find((c) => c.name === VIEWER_SESSION_COOKIE);
    expect(
      viewerSession,
      `expected ${VIEWER_SESSION_COOKIE} cookie after correct PIN`,
    ).toBeDefined();
    expect(viewerSession?.value).toBeTruthy();
  });

  test("wrong PIN shows error and does not issue a session cookie", async ({ page, tenant }) => {
    await page.goto(tenant.tenantUrl("/viewer-access"));

    // Pick any 6-digit string that isn't the seeded PIN. The fixture
    // generates 6-digit PINs, so this stays in the same shape.
    const wrong = tenant.viewerPin === "000000" ? "999999" : "000000";

    await page.getByPlaceholder("Access code").fill(wrong);
    await page.getByRole("button", { name: /^Continue$/ }).click();

    // The action reports `{ fieldError: "Invalid PIN. N attempts left." }`
    // and stays on /viewer-access.
    await expect(page).toHaveURL(/\/viewer-access/);
    await expect(page.getByText(/Invalid PIN\.\s+\d+ attempts left/i)).toBeVisible();

    const cookies = await page.context().cookies();
    const viewerSession = cookies.find((c) => c.name === VIEWER_SESSION_COOKIE);
    expect(
      viewerSession,
      `did NOT expect ${VIEWER_SESSION_COOKIE} cookie after wrong PIN`,
    ).toBeUndefined();
  });

  test("attempts counter decrements on repeated wrong PINs", async ({ page, tenant }) => {
    await page.goto(tenant.tenantUrl("/viewer-access"));

    const wrong1 = tenant.viewerPin === "000000" ? "999999" : "000000";
    const wrong2 = tenant.viewerPin === "111111" ? "888888" : "111111";

    await page.getByPlaceholder("Access code").fill(wrong1);
    await page.getByRole("button", { name: /^Continue$/ }).click();
    const firstError = await page
      .getByText(/Invalid PIN\.\s+(\d+) attempts left/i)
      .innerText();
    const firstCount = Number(firstError.match(/(\d+) attempts left/i)?.[1] ?? "");

    await page.getByPlaceholder("Access code").fill(wrong2);
    await page.getByRole("button", { name: /^Continue$/ }).click();
    const secondError = await page
      .getByText(/Invalid PIN\.\s+(\d+) attempts left/i)
      .innerText();
    const secondCount = Number(secondError.match(/(\d+) attempts left/i)?.[1] ?? "");

    // Counter must strictly decrement — if it doesn't, the lockout
    // persistence layer is broken and the app has a real vulnerability.
    expect(secondCount).toBeLessThan(firstCount);
  });
});
