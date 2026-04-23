# Research spec — 0d interaction-tests-critical-paths

**Author:** polish agent, 2026-04-23.
**Workstream:** Priority 0, item 0d in `docs/nightly-queue.md`.
**Status:** research only — no code changed in this run.
**Depends on:** 0a smoke sweep (done 2026-04-21), 0b mobile smoke
(merged 2026-04-22 as `f87afe0`), 0c CI matrix (branch ready, blocked
on staging gate per `docs/nightly/2026-04-22-build.md`).

---

## Problem

The repo's e2e coverage is currently a *smoke sweep* — every route is
visited and asserted to return 2xx, render a landmark, and not raise a
pageerror. That's great for catching "did this route 500" regressions
but it tells us nothing about whether the **user-facing flows that the
business depends on** still work end-to-end.

The queue calls out five critical paths that must not regress silently:

1. **signup → trial → paid** — landing-page visitor becomes a paying
   customer. If this breaks, revenue stops.
2. **admin roster** — create homeroom → create student → assign space.
   This is the prerequisite for any dismissal run; a broken roster flow
   blocks onboarding.
3. **dismissal** — controller activates a space, viewer sees it, admin
   empties it, history logs it. The product's core value prop. If this
   breaks at 3pm it kills a school's trust in one afternoon.
4. **viewer PIN gate** — correct PIN gets the viewer in, wrong PIN
   rate-limits, no session leaks across orgs. Security-critical and
   already has real lockout logic in
   `app/domain/auth/viewer-access.server.ts` that can silently break.
5. **branding upgrade gate** — FREE users see the upsell, CAMPUS users
   see the real inputs. Protects the paid tier's value.

None of these have real e2e coverage today. `e2e/drills.spec.ts`
demonstrates the "skip if no admin session" shape we use when a test
can't seed auth, but that makes the test effectively a no-op in CI.

## Current state

### What's in place

- **Playwright**: `@playwright/test@^1.59.1`, config at
  `playwright.config.ts` with three projects (`chromium`, `mobile-iphone`,
  `mobile-pixel`). Base URL `http://localhost:8787`. Web server: `npx
  wrangler dev --log-level=warn` with 180s timeout and
  `reuseExistingServer: !process.env.CI`.
- **Staging config**: `playwright.staging.config.ts` (per AGENTS.md)
  reads `PLAYWRIGHT_BASE_URL` for staging smoke.
- **Existing specs**:
  - `e2e/smoke.spec.ts` + `e2e/smoke.mobile.spec.ts` + `e2e/smoke-routes.ts`
    — route sweep (no auth, no interaction).
  - `e2e/auth.spec.ts` — verifies login/signup form elements render.
  - `e2e/drills.spec.ts` — demonstrates the `isOnAdminDrills()` probe
    that `test.skip`s when no admin session is seeded. Non-functional
    as coverage today.
  - `e2e/marketing.spec.ts` — marketing-nav link check.
- **Seeding**: `scripts/seed.ts` creates a single admin user
  (`noahsundberg@gmail.com`) against `file:./dev.db` via `@libsql/client`.
  Password hashing matches `app/domain/auth/better-auth.server.ts`
  (PBKDF2-SHA256 / 100k iterations / 32-byte key / `salt:key` hex).
  **No tenant / org / student seed**, no viewer PIN, no spaces.

### Host detection matters for these tests

Per `app/domain/utils/host.server.ts`:
- `localhost` is a **marketing host** (listed in `MARKETING_HOSTS` in
  `wrangler.jsonc`). Routes like `/admin/*`, `/update/:space`,
  `/empty/:space` treat localhost as the apex and redirect
  unauthenticated traffic to `/login`.
- Tenant routes live on a subdomain. Dev supports `{slug}.localhost`
  (`devTenantSlug()` returns `tome` for `tome.localhost`), but the
  Playwright `baseURL` is `http://localhost:8787` — so tenant routes
  aren't reachable without either a `/etc/hosts` entry or (cleaner)
  per-test `page.goto("http://{slug}.localhost:8787/...")`.

This is why `smoke.spec.ts` documents flows 0d needs explicitly:
> *"Workstream 0d ('interaction-tests-critical-paths') is the better
> home for seeded flows. This smoke sweep is deliberately thin."*

### Stripe is real in dev

`app/domain/billing/stripe.server.ts` reads `STRIPE_SECRET_KEY`,
`STRIPE_CAR_LINE_PRICE_ID`, `STRIPE_CAMPUS_PRICE_ID`,
`STRIPE_WEBHOOK_SECRET` from env. `/api/billing/checkout` creates a
real Stripe Checkout Session and redirects to `checkout.stripe.com`.
There is no built-in test-clock or mock-mode switch. Playwright cannot
drive the Stripe hosted page reliably (CAPTCHA, 3DS, cross-origin
nav); the signup-to-paid test has to stop at the redirect boundary
OR we add a feature-flagged "bypass checkout" code path behind an env
var that only exists in the E2E / staging build.

## Proposal

Build a **seeded-tenant e2e layer** under `e2e/flows/` that drives real
HTTP requests against a freshly-seeded tenant on each run. Factor the
seed logic into a Playwright fixture (`e2e/fixtures/seeded-tenant.ts`)
so every flow spec starts from a known state without copy-pasting
setup. Use the existing `wrangler dev` server (fixture seeds directly
against `file:./dev.db` via `@libsql/client`, mirroring
`scripts/seed.ts`). For tenant-host traffic, use
`{slug}.localhost:8787` URLs — no `/etc/hosts` changes needed because
wrangler dev accepts any Host header on its listening port.

For the three flows that touch Stripe or real viewer-session cookies:
stop the test at the provable boundary (the Stripe Checkout redirect
URL for signup-to-paid; the viewer-session cookie for viewer-pin) and
assert the pre-redirect state. No mock, no test-mode fork.

Keep each flow in its own file so a single failure isn't ambiguous and
so the `test.fixme(...)` pattern from the smoke sweep can be reused
for real bugs found during testing (the queue's **quality rule**: never
codify a bug as passing).

## File list

### New files

- `e2e/fixtures/seeded-tenant.ts` — Playwright `test.extend()` fixture
  that before each spec:
  1. Generates a unique tenant slug (`e2e-<random6>`) so parallel runs
     don't clobber each other.
  2. Opens `file:./dev.db` via `@libsql/client` and inserts: Org,
     AppSettings (with a hashed viewer PIN), admin User with PBKDF2
     password (reuse `hashPassword` from `scripts/seed.ts`), Session
     row for an already-logged-in cookie, one HomeRoom, one Space.
     Returns `{ slug, adminCookie, viewerPin, spaceNumber, homeroomId }`.
  3. Teardown: best-effort `DELETE` of the same rows. Failure tolerated
     (tests must be idempotent on the IDs, not rely on cleanup).
- `e2e/fixtures/seed-helpers.ts` — pure functions extracted from
  `scripts/seed.ts` (`hashPassword`, `generateId`) so the fixture and
  the existing seed script share hashing logic. `scripts/seed.ts`
  updates to import from here.
- `e2e/flows/signup-to-paid.spec.ts` — unauthenticated visitor signs
  up, lands on the checkout POST handler, asserts the redirect URL
  starts with `https://checkout.stripe.com/` (proves the session was
  created with valid price + customer). Does NOT drive Stripe's page.
- `e2e/flows/admin-roster.spec.ts` — seeded admin creates a homeroom
  via `/admin/children` form submit, creates a student via
  `/create/student`, assigns a space number, asserts the student
  appears in `/admin/children` with the space number.
- `e2e/flows/dismissal.spec.ts` — seeded admin hits `/update/:space`
  (POST), opens a second tab/context at the board page, asserts the
  space flipped to ACTIVE, POSTs `/empty/:space`, asserts history at
  `/admin/history` logs the call event.
- `e2e/flows/viewer-pin.spec.ts` — unauthenticated visit to
  `{slug}.localhost:8787/viewer-access`, wrong PIN x5 triggers lockout
  (assert the error copy from `getViewerLockState()`), correct PIN
  issues a `viewer-session` cookie and lands on `/`.
- `e2e/flows/branding-upgrade-gate.spec.ts` — two subtests:
  1. FREE/CAR_LINE admin on `/admin/branding` sees "Logo upload &
     custom domain" upgrade prompt + "Upgrade to Campus" CTA.
  2. CAMPUS admin on `/admin/branding` sees the real logo upload input
     and custom-domain field, NOT the upgrade prompt.

### Existing files touched

- `scripts/seed.ts` — import `hashPassword` / `generateId` from
  `e2e/fixtures/seed-helpers.ts`. Lift-and-shift, no behavior change.
- `playwright.config.ts` — no change expected. If `WebSocket`/Durable
  Object work in wrangler dev flakes the dismissal test, add
  `testDir: "./e2e"` globs to route fixture files and consider a
  `--persist-to=/tmp/wrangler-state` note (already documented in
  `2026-04-21-build.md` for the fuse-mount SQLITE_IOERR_DELETE case).
- `docs/nightly-queue.md` — flip 0d from `[ ]` to `[→]` when build
  picks it up, then `[x]` on merge.

### Files read but not modified

- `app/domain/auth/viewer-access.server.ts` — PIN verify + lockout
  thresholds.
- `app/domain/billing/checkout.server.ts` — Stripe Checkout Session
  creation shape.
- `app/routes/_index.tsx`, `app/routes/update.$space.tsx`,
  `app/routes/empty.$space.tsx` — dismissal loop entry points.
- `app/routes/admin/branding.tsx` — upgrade-gate copy (“Upgrade to
  Campus”, “Logo upload & custom domain”).
- `app/routes/admin/children.tsx`, `app/routes/create/create.student.tsx`,
  `app/routes/create/create.homeroom.tsx` — roster form field names.
- `app/lib/plan-limits.ts` — `planAllowsReports` pattern, parallel to
  the branding gate.

## Testing approach

1. **Local run first** — each new spec must pass against
   `wrangler dev` locally before the build agent pushes. Run
   `npx playwright test e2e/flows/<file>.spec.ts` with the seeded-
   tenant fixture. Repeat three times to catch flakiness (especially
   the dismissal spec, which races a websocket broadcast).
2. **CI** — the specs live under `e2e/flows/**`, which the existing
   `chromium` project globs in by default (it only excludes
   `smoke.mobile.spec.ts`). No config change needed for the desktop
   shard in `.github/workflows/e2e.yml`. Mobile shards should NOT
   pick up the flows — they're viewport-agnostic and would double CI
   time for zero extra signal; add `testIgnore: /flows\//` to the two
   mobile projects in `playwright.config.ts` when the build agent
   lands this.
3. **Staging smoke** — `smoke.spec.ts` already runs against staging
   per AGENTS.md's gate. Do not extend the staging smoke set with the
   flow specs; they mutate data and the staging D1 is shared. Keep
   flows to `wrangler dev` + local D1.
4. **Quality rule** — if a flow spec uncovers a real bug (e.g. the
   dismissal spec finds that `/empty/:space` accepts arbitrary space
   numbers without org scoping), the build agent MUST leave a
   `test.fixme(...)` comment referencing the bug and write it up in
   the nightly build summary. Do not weaken assertions to make the
   test pass.

## Open questions

1. **Stripe Checkout in CI** — the signup-to-paid spec stops at the
   `checkout.stripe.com/` redirect. Is that enough coverage, or does
   Noah want a further test that drives the hosted Stripe page with
   `4242 4242 4242 4242` via Stripe's test environment?  Driving the
   hosted page from Playwright is fragile (rate-limited CAPTCHA, 3DS
   flows). Alternatives: (a) add a feature-flagged E2E bypass in
   `app/domain/billing/checkout.server.ts` gated on
   `process.env.E2E_BYPASS_STRIPE === "1"` that short-circuits to the
   success page with a fake `session_id`; (b) wait for a dedicated
   billing-e2e workstream. Default without answer: stop at the
   redirect. **Noah to decide.**
2. **Admin session fixture vs login-each-test** — the fixture
   proposed here inserts a `Session` row directly so the test starts
   with a logged-in cookie. Cleaner than driving `/login` every time,
   but couples the tests to the Better Auth session table schema. If
   Better Auth upgrades change that table, the fixture breaks. The
   alternative is a `loginViaUi(page, email, password)` helper — 2s
   per test but decoupled from the schema. **Default: direct session
   insert**; reconsider if Better Auth major bump is imminent.
3. **Durable Object state across specs** — the dismissal spec flips a
   space to ACTIVE via `BINGO_BOARD` (a Durable Object). Wrangler
   dev's DO state survives across specs in the same run, which means
   the fixture must EMPTY the space in teardown or subsequent runs
   see stale ACTIVE state. Acceptable risk or worth writing an
   explicit `resetBoardForSpace(slug, spaceNumber)` helper in the
   fixture? **Default: explicit helper.**
4. **Viewer-PIN rate-limit reset** — the viewer-pin spec exhausts the
   lockout counter. `viewer-access.server.ts` uses the `RL_VIEWER`
   rate limiter (Durable Object-backed). In wrangler dev the limiter
   state survives across specs, so parallel runs or retries will see
   cascading lockouts. Fixture either waits out the lockout (slow) or
   deletes the viewer-session cookie + uses a fresh slug per spec
   (default — already doing unique slugs).
5. **FREE plan in the fixture** — the branding-upgrade-gate spec
   needs a seeded org on the `FREE` plan. The signup flow requires
   picking a paid plan, so the fixture inserts the Org row directly
   with `billingPlan: "FREE"` (or `CAR_LINE`) — bypassing the pricing
   page. Any concern about drift between "FREE via migration default"
   and "FREE via fixture"?  **Default: fixture writes
   `billingPlan: "CAR_LINE"` for the gated case and `"CAMPUS"` for
   the ungated case to match the production paths.**

## Not in scope

- Parent/family app flows (item 11, blocked).
- Stripe webhook retry handling (already covered by
  `app/domain/billing/webhook-idempotency.test.ts` as unit).
- The underlying 0a bugs (`/status` and `/api/healthz` redirects) —
  these are one-line fixes, not e2e concerns.

## Rollout

One branch, one merge: `nightly-build/YYYY-MM-DD-0d-interaction-tests-critical-paths`.
Branch lands all five flow specs + fixture in a single commit so we
don't ship a half-built fixture. Per AGENTS.md, gate behind typecheck
+ unit + staging smoke before merging. Each flow spec is independent,
so a single flaky spec doesn't block the others from going green —
but the fixture itself has to be rock solid before merge.
