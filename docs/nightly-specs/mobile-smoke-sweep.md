# Spec — workstream 0b: mobile-smoke-sweep

**Queue ID:** `0b`
**Slug:** `mobile-smoke-sweep`
**Author:** polish agent, 2026-04-22 nightly.
**Depends on:** `0a` (smoke-test-sweep) — landed 2026-04-21 on branch
`nightly-build/2026-04-21-0a-smoke-test-sweep` (unmerged).

---

## Why

Workstream `0a` proved every route renders on Chromium desktop (1280×720).
Schools drop kids off from a phone — tenant controllers and guardian viewers
will all use iPhone/Android. A single-viewport sweep is insufficient. Any
layout break at 390×844 (iPhone 13) or 412×915 (Pixel 7) is a real bug that
only shows up at mobile widths, the most common example being the board
grid overflowing the viewport and forcing a horizontal scrollbar during
dismissal. This workstream replays the route enumeration from `0a` under
two mobile viewports and adds two targeted mobile-only assertions that the
desktop smoke sweep can't catch.

---

## Deliverable

One new Playwright spec file, one playwright config change, zero
application code changes.

### Files to create

- `e2e/smoke.mobile.spec.ts` — mobile route enumeration + mobile-only
  targeted checks (admin drawer, `MobileCallerView` render path).

### Files to modify

- `playwright.config.ts` — add two mobile projects (`mobile-iphone`,
  `mobile-android`) alongside the existing `chromium` project. Do NOT
  rename or remove the existing project — `0a`'s smoke sweep continues
  to run on it unchanged.

### Files to leave alone

- `e2e/smoke.spec.ts` — desktop-only. Keep it as-is; don't parametrize.
  Route drift is a separate concern handled by `0a`.
- All `app/**` code. This is a test-only workstream.

---

## Playwright config changes

`playwright.config.ts` currently has a single `chromium` project. Extend the
`projects` array to three entries:

```ts
projects: [
  {
    name: "chromium",
    use: { ...devices["Desktop Chrome"] },
  },
  {
    name: "mobile-iphone",
    use: { ...devices["iPhone 13"] },
    testMatch: /smoke\.mobile\.spec\.ts/,
  },
  {
    name: "mobile-android",
    use: { ...devices["Pixel 7"] },
    testMatch: /smoke\.mobile\.spec\.ts/,
  },
],
```

Rationale for `testMatch`: we only want `smoke.mobile.spec.ts` to run under
the mobile projects. The existing `auth.spec.ts`, `marketing.spec.ts`,
`drills.spec.ts`, and `smoke.spec.ts` should stay Chromium-only by default
so CI time doesn't 3x. If the build agent wants to broaden later, they can
drop `testMatch` in a follow-up. Keep that out of scope.

Leave the `webServer` block alone — `wrangler dev` serves all projects from
the same port.

---

## Test file structure (`e2e/smoke.mobile.spec.ts`)

Mirror the shape of `e2e/smoke.spec.ts` — a loose "does it render + is the
status 2xx" sweep — but with only the subset of routes where mobile
layout matters, plus two mobile-only targeted tests.

### Part 1 — Route render sweep (public routes only)

Replicate the public marketing group from `smoke.spec.ts`. Skip the
authenticated redirect tests (they all land on `/login`, which is
already covered by the public group, so running them again at mobile
adds zero information). Routes:

- `/` — landing. Assert the MarketingNav link "Pickup Roster" is visible
  (role=link, name=/Pickup Roster/). Assert `document.scrollingElement`
  has `scrollWidth <= clientWidth + 1` — no horizontal overflow.
- `/pricing` — plan cards stack. Assert the three plan headings are
  visible ("Free trial", "Car Line", "Campus") and each one sits in its
  own row (compute bounding boxes; `rect.top` of "Car Line" must be
  strictly greater than `rect.bottom` of "Free trial" minus 1px).
- `/faqs` — heading visible; no horizontal overflow.
- `/status` — currently `test.fixme` pending the middleware fix from
  `0a`. Mirror the fixme here with the same reason (link to
  `docs/nightly/2026-04-21-build.md` BUG 2) so the mobile suite and the
  desktop suite flip green together when the fix lands.
- `/login` — email field visible, no horizontal overflow.
- `/signup?plan=car-line` — "Your name" field visible; step 1 form
  doesn't overflow.
- `/forgot-password`, `/reset-password` — email field visible on one;
  the other renders its token-missing state without 500'ing.

Skip (out of scope; mirror comments from `smoke.spec.ts`):
- All `/admin/*`, `/platform/*`, and tenant-auth routes — they redirect
  to `/login` on the marketing host, already covered by the `/login`
  test above.
- All dynamic-param routes — `0d` territory.
- POST-only API routes.

### Part 2 — Admin drawer behavior (mobile-only)

The admin layout (`app/routes/admin/layout.tsx`, lines 143-186 at time of
spec) renders a hamburger button at `md:hidden` and hides the desktop
`<aside>`. At `< 768px` the drawer is the only way to navigate admin.
Test the open/close contract:

1. `page.goto("/admin")` — unauthenticated redirects to `/login`. This
   means we can't actually exercise the admin drawer without a seeded
   admin session, same gap as `smoke.spec.ts`. Options:
   - **Recommended:** mark this test `test.fixme("Needs seeded admin
     session — blocked on fixture from 0d.")` so the intent is
     codified now and the test flips live when the fixture lands.
   - Alternative: use `page.setContent(...)` with a stubbed admin
     layout. Rejected — it's not really testing the production code
     path and creates maintenance burden.

Document selectors the future test will use:
- Open: `page.getByRole("button", { name: "Open navigation" })`.
- Close: `page.getByRole("button", { name: "Close navigation" })`.
- Overlay dismiss: click any point in `[role="presentation"]` outside
  the drawer panel (the `<div onClick={close}>` wrapping the overlay
  stops propagation on the panel, so clicking the backdrop closes).
- Nav items: `page.getByRole("link", { name: /Dashboard|Users|Children & Classes|Drills|History|Branding|Billing/ })`.

### Part 3 — Marketing landing no-overflow (mobile-only)

Guard against the specific regression we care most about: anything on `/`
that pushes the viewport wider than the device width. Assert:

```ts
const { scrollWidth, clientWidth } = await page.evaluate(() => {
  const root = document.scrollingElement || document.documentElement;
  return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
});
expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // allow 1px rounding
```

Run the same assertion on `/`, `/pricing`, `/faqs`, `/login`,
`/signup?plan=car-line`.

### Part 4 — Board `MobileCallerView` render path (mobile-only, fixme)

`app/routes/_index.tsx` renders `<MobileCallerView>` inside a
`md:hidden w-full` container (line 341 at time of spec) when the request
lands on a tenant host. On the marketing host the whole branch is
skipped and `MarketingLanding` is returned instead, so we can't exercise
this without either a tenant host or a seeded tenant context. Mark
`test.fixme("Needs tenant host — blocked on 0d fixture.")` with a
comment pointing at the line above so the expected target is clear.

---

## Acceptance criteria

- `npm run test:e2e -- --project=mobile-iphone` runs only
  `smoke.mobile.spec.ts` and exits 0 (passes + fixmes, zero fails).
- `npm run test:e2e -- --project=mobile-android` same.
- `npm run test:e2e -- --project=chromium` is unchanged — all existing
  passing tests still pass, same count (`auth.spec.ts` 3, `marketing.spec.ts`
  4-ish, `smoke.spec.ts` 30 passing + 2 fixme, `drills.spec.ts` as-is).
- `npm run test:e2e` with no project flag runs ALL projects. Total time
  budget on a clean machine: < 45s.
- Every `test.fixme` includes an inline comment pointing at the blocker
  (bug in repo or missing fixture), never a silent skip.

---

## Testable behaviors (crib sheet for the build agent)

| Behavior | Route | Viewport | Assertion |
| --- | --- | --- | --- |
| Landing renders | `/` | 390×844, 412×915 | nav link "Pickup Roster" visible |
| No horizontal overflow on landing | `/` | both | `scrollWidth <= clientWidth + 1` |
| Pricing cards stack vertically | `/pricing` | both | bounding boxes are ordered top→bottom |
| Pricing no overflow | `/pricing` | both | `scrollWidth <= clientWidth + 1` |
| FAQs renders | `/faqs` | both | heading visible, no overflow |
| Login mobile form | `/login` | both | email field visible, no overflow |
| Signup mobile form | `/signup?plan=car-line` | both | "Your name" visible, no overflow |
| Status renders | `/status` | both | `fixme` — blocked on middleware bug from 0a |
| Forgot-pw renders | `/forgot-password` | both | email input visible |
| Reset-pw renders | `/reset-password` | both | empty-token state renders without 500 |
| Admin drawer open/close | `/admin` | both | `fixme` — needs seeded admin session |
| `MobileCallerView` renders | tenant `/` | both | `fixme` — needs tenant host |

12 routes × 2 projects = 24 test cases. ~8 land green, ~16 are fixme'd
on a documented blocker. That's the correct ratio given the fixture gap
`0d` will close — do NOT paper over the fixmes to pad the green count.

---

## Out of scope

- CI config (`e2e.yml`). That's workstream `0c`. The build agent should
  NOT touch `.github/workflows/`.
- Seeded admin / tenant host fixtures. That's a prereq for `0d` and
  several of our fixme'd tests. If the build agent has appetite, they
  can land the fixture as a separate commit in the same branch and
  flip the fixmes live — but it's a stretch goal, not required.
- Visual snapshot/screenshot tests. Too flaky for a smoke sweep.
  Defer until we have a need.
- iPad/tablet viewports. `md` breakpoint in Tailwind is 768px, so iPad
  portrait (768×1024) straddles desktop/mobile. Not interesting enough
  to triple the matrix tonight.

---

## Open questions for Noah

1. **Fixme policy on mobile mirrors of desktop fixmes.** The `/status`
   and `/api/healthz` bugs from `0a` are marked `fixme` on desktop. We
   propose mirroring `/status` as `fixme` on mobile too (same root
   cause). Acceptable, or would you prefer the mobile sweep skip the
   route outright to avoid duplicate noise? Default: mirror the fixme.
2. **Do you want a separate mobile sweep in CI on every PR, or
   nightly-only?** Running all three projects on every PR roughly
   doubles Playwright CI time (~9s → ~20-30s). Fine today, maybe not
   at 100+ tests. `0c` owns this decision — not blocking for this
   spec. Default in this spec: add the projects but keep `testMatch`
   scoped so CI cost stays flat.
3. **Device choice.** We propose `iPhone 13` (390×844) and `Pixel 7`
   (412×915). Playwright ships both. Alternatives: `iPhone 15 Pro`
   (393×852), `Galaxy S8+` (360×740 — the smallest realistic Android).
   If you want to cover the "smallest screen" case, we'd swap Pixel 7
   for Galaxy S8+.
4. **Mobile Safari (WebKit).** The `devices["iPhone 13"]` descriptor
   uses the user agent + viewport but is still Chromium by default
   under Playwright unless you add `{ ...devices["iPhone 13"], browserName: "webkit" }`.
   Do we want real Mobile Safari coverage? WebKit is the #1 source of
   layout surprises on iOS. Cost: +1 browser binary in CI (`npx
   playwright install webkit`), minor CI-time increase. Default in
   this spec: Chromium-simulated mobile only; WebKit deferred to a
   follow-up.

---

## References

- Existing desktop sweep: `e2e/smoke.spec.ts` (see the top-of-file
  comment for route categorization and skip rationale — the mobile
  sweep should mirror those conventions).
- Admin layout drawer: `app/routes/admin/layout.tsx` lines 115-196.
- `MobileCallerView` mount point: `app/routes/_index.tsx` lines 341-350.
- Playwright device descriptors:
  https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json
- Bugs to keep fixme'd in sync: `docs/nightly/2026-04-21-build.md` §
  "Bugs found by the sweep".
