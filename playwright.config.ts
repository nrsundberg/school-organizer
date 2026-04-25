import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — desktop + mobile smoke matrix.
 *
 * Projects:
 *   - `chromium`       : runs every spec EXCEPT `smoke.mobile.spec.ts`.
 *                        This is the primary desktop-coverage project. It
 *                        runs all auth/marketing/drills specs and the
 *                        desktop `smoke.spec.ts` route sweep.
 *   - `mobile-iphone`  : runs ONLY `smoke.mobile.spec.ts` under the
 *                        `iPhone 13` device emulation (390×844, WebKit UA,
 *                        `isMobile: true`).
 *   - `mobile-pixel`   : runs ONLY `smoke.mobile.spec.ts` under the
 *                        `Pixel 7` device emulation (412×915, Chrome UA).
 *
 * Why mobile projects only run the mobile smoke file: `smoke.mobile.spec.ts`
 * asserts a viewport-dependent invariant (no horizontal overflow) which
 * needs the mobile viewport. The desktop auth/marketing specs and the
 * `e2e/flows/**` interaction specs are viewport-agnostic and would
 * just double the CI surface. The mobile projects use `testMatch` (not
 * `testIgnore`) so they are strictly opt-in — new specs dropped under
 * `e2e/flows/` or `e2e/` generally run on `chromium` only.
 *
 * Wiring mobile runs into CI is workstream 0c
 * (`ci-playwright-matrix` in `docs/nightly-queue.md`). Locally, all projects
 * run by default with `npm run test:e2e`; scope with
 * `npx playwright test --project=mobile-iphone` etc.
 *
 * Note: `Pixel 7` uses Playwright's Chromium emulation, not WebKit — so the
 * mobile matrix is actually (WebKit on iPhone) × (Chromium on Pixel).
 * WebKit needs `npx playwright install webkit` on fresh machines; CI already
 * installs all browsers in `.github/workflows/e2e.yml` via `--with-deps`.
 */
export default defineConfig({
  testDir: "./e2e",
  // Pin artifact location so cleanup hooks (CI / scheduled-task wrappers)
  // can `rm -rf` it deterministically after each run.
  outputDir: "./test-results",
  // Drop traces / videos / screenshots on passing tests so a green run
  // leaves zero on-disk debris. Combined with the `use` block below,
  // only failure artifacts survive the run.
  preserveOutput: "failures-only",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "./playwright-report" }],
      ]
    : "list",
  use: {
    baseURL: "http://localhost:8787",
    // `retain-on-failure` instead of `on-first-retry` — slightly more
    // useful debugging signal, still cleaned up by `preserveOutput`.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // Desktop chromium runs every spec except the mobile-only smoke sweep.
      testIgnore: /smoke\.mobile\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-iphone",
      testMatch: /smoke\.mobile\.spec\.ts$/,
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "mobile-pixel",
      testMatch: /smoke\.mobile\.spec\.ts$/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npx wrangler dev --log-level=warn",
    url: "http://localhost:8787",
    timeout: 180000,
    reuseExistingServer: !process.env.CI,
  },
});
