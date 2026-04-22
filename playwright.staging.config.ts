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
 */
export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL ??
      "https://school-organizer-staging.sundbergne.workers.dev",
    trace: "on-first-retry",
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
