import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for hitting a remote staging deploy.
 *
 * Used by the gating layer in AGENTS.md — after `npm run deploy:staging`,
 * agents run the smoke sweep against the deployed URL instead of spinning
 * up wrangler dev locally.
 *
 * Set PLAYWRIGHT_BASE_URL to override the default staging hostname:
 *   PLAYWRIGHT_BASE_URL=https://school-organizer-staging.sundbergne.workers.dev \
 *     npx playwright test --config=playwright.staging.config.ts e2e/smoke.spec.ts
 *
 * The default is `https://staging.pickuproster.com` (the apex + wildcard
 * Custom Domain layout that mirrors prod). The workers.dev URL still
 * resolves to the same Worker (env.staging has `workers_dev: true`) and
 * is fine as a fallback override, but the default exercises the same
 * routing/cookie/cross-subdomain code paths that prod does.
 */
export default defineConfig({
  testDir: "./e2e",
  // Pin artifact location so the scheduled-task wrapper can `rm -rf` it
  // deterministically after each run. Without this the dir name varies
  // and old runs leak across the sandbox rootfs.
  outputDir: "./test-results",
  // Drop traces / videos / screenshots on passing tests. Combined with
  // the `use` block below, only failure artifacts survive the run, so
  // a green nightly leaves zero on-disk debris.
  preserveOutput: "failures-only",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "./playwright-report" }],
      ]
    : "list",
  use: {
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL ?? "https://staging.pickuproster.com",
    // `retain-on-failure` instead of `on-first-retry` — slightly more
    // useful debugging signal, still cleaned up by `preserveOutput`.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Staging is a real deployment: longer timeout than local so cold
    // starts + D1 cross-region hops don't flake out assertions.
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
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
  // No webServer block — staging is already deployed when we run.
});
