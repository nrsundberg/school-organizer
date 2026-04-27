/**
 * Mobile smoke sweep — the same route enumeration as `smoke.spec.ts` but
 * executed under mobile viewport projects (iPhone 13 and Pixel 7) defined in
 * `playwright.config.ts`.
 *
 * The shape mirrors the desktop sweep: for every route we assert the same
 * (no 5xx, no 4xx, landmark visible, no uncaught pageerror) AND add one
 * mobile-specific assertion:
 *
 *   • No horizontal overflow on <body>. On a phone, horizontal scroll is
 *     almost always a bug — a container with `min-w-[...]`, a large table,
 *     or a long unbroken string that missed `overflow-x-auto`. We measure
 *     `document.documentElement.scrollWidth` against the viewport width and
 *     allow a tiny pixel tolerance for scrollbar/fractional rendering.
 *
 * The 0b spec in `docs/nightly-queue.md` also calls out three deeper
 * concerns: (a) the board grid doesn't overflow, (b) the mobile caller view
 * renders, (c) the admin sidebar opens as a drawer. All three require a
 * seeded authenticated tenant (board/caller are behind `/update/:space`
 * etc., and the admin sidebar drawer only appears after the admin layout
 * loader passes). Workstream 0d ("interaction-tests-critical-paths") is the
 * right home for those seeded flows.
 *
 * For unauthenticated routes, the admin layout renders its ErrorBoundary
 * ("Login Required") — that page has no hamburger/drawer because the
 * sidebar only mounts when the loader resolves. We still assert it renders
 * without horizontal overflow on mobile, which is the most common mobile
 * regression (e.g. a div that forgot `max-w-full`).
 *
 * This file is run by the `mobile-iphone` and `mobile-pixel` Playwright
 * projects (see `playwright.config.ts`). The `chromium` desktop project
 * does NOT run it — it would double the smoke surface with no added signal.
 */
import { test, expect } from "@playwright/test";
import {
  publicMarketingRoutes,
  tenantAuthedRoutes,
  printRoutes,
  platformRoutes,
  visitAndCapture,
  assertNotServerError,
  assertAllowedFinalPath,
  assertLandmark,
  type RouteSpec,
} from "./smoke-routes";

/**
 * Tolerance (in CSS pixels) for the body width vs. viewport width check.
 * Rationale: sub-pixel rendering, vertical scrollbar width on some UA
 * configurations, and HeroUI's focus-ring outline can momentarily add a few
 * px of "overflow" that don't visually break the layout. 4px is the smallest
 * value we've seen reliably pass on both iPhone 13 (390px) and Pixel 7
 * (412px) viewports.
 */
const HORIZONTAL_OVERFLOW_TOLERANCE_PX = 4;

/**
 * Assert the page does not introduce horizontal scrolling. This catches the
 * most common mobile regression: a container that forgot a `max-w-full`, a
 * table without `overflow-x-auto`, or a `min-w-[xxx]px` that survived a
 * copy-paste from a desktop layout.
 */
async function assertNoHorizontalOverflow(
  page: import("@playwright/test").Page,
  spec: RouteSpec,
) {
  const metrics = await page.evaluate(() => ({
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
    viewportWidth: window.innerWidth,
  }));

  const worstScrollWidth = Math.max(
    metrics.docScrollWidth,
    metrics.bodyScrollWidth,
  );
  const overflowBy = worstScrollWidth - metrics.viewportWidth;

  expect(
    overflowBy,
    `Route ${spec.path} overflows horizontally by ${overflowBy}px on a ${metrics.viewportWidth}px viewport. ` +
      `document.scrollWidth=${metrics.docScrollWidth}, body.scrollWidth=${metrics.bodyScrollWidth}.`,
  ).toBeLessThanOrEqual(HORIZONTAL_OVERFLOW_TOLERANCE_PX);
}

async function smokeMobile(page: import("@playwright/test").Page, spec: RouteSpec) {
  const { response, pageErrors } = await visitAndCapture(page, spec.path);

  assertNotServerError(spec.path, response);
  assertAllowedFinalPath(spec, page.url());
  await assertLandmark(page, spec);
  // Settle i18n hydration before measuring horizontal overflow. SSR ships
  // raw translation keys (e.g. "forgotPassword.emailPlaceholder") which are
  // significantly longer than the resolved English copy; on routes whose
  // landmark spec is generic enough (`role: heading`) to match the SSR
  // literal-key heading, `assertLandmark` returns before the http backend's
  // `/locales/{lng}/{ns}.json` fetches finish, and `scrollWidth` ends up
  // measuring the inflated literal-key layout. Waiting for networkidle
  // gives those fetches time to complete; we swallow the timeout because
  // some routes legitimately keep network busy (e.g. status-page polling).
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await assertNoHorizontalOverflow(page, spec);

  if (pageErrors.length > 0) {
    throw new Error(
      `Route ${spec.path} raised ${pageErrors.length} pageerror(s):\n  - ${pageErrors.join("\n  - ")}`,
    );
  }
}

function defineMobileRouteTest(spec: RouteSpec) {
  test(`GET ${spec.path} [mobile]`, async ({ page }) => {
    if (spec.fixme) {
      test.fixme(true, spec.fixme);
    }
    await smokeMobile(page, spec);
  });
}

test.describe("smoke[mobile]: public marketing routes", () => {
  for (const spec of publicMarketingRoutes) {
    defineMobileRouteTest(spec);
  }
});

test.describe("smoke[mobile]: tenant-authenticated routes (unauthenticated -> graceful)", () => {
  for (const spec of tenantAuthedRoutes) {
    defineMobileRouteTest(spec);
  }
});

test.describe("smoke[mobile]: print routes (unauthenticated -> graceful)", () => {
  for (const spec of printRoutes) {
    defineMobileRouteTest(spec);
  }
});

test.describe("smoke[mobile]: platform admin routes (unauthenticated -> redirect)", () => {
  for (const spec of platformRoutes) {
    defineMobileRouteTest(spec);
  }
});
