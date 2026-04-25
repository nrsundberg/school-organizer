# Research spec — 0d.2 interaction-tests-signup-to-paid

**Author:** polish agent, 2026-04-25.
**Workstream:** Priority 0, item 0d.2 in `docs/nightly-queue.md`.
**Status:** research only — no code changed in this run.
**Depends on:** `e2e/fixtures/seeded-tenant.ts` (landed 2026-04-23-manual-1438) and the
0d.1 spec pattern (landed on `nightly-build/2026-04-24-0d1-dismissal`,
awaiting Noah's morning gate per `docs/nightly/2026-04-24-0d1-dismissal-build.md`).

---

## Problem

The queue line item — *"signup → trial → stripe checkout (test mode) → back on app"* — is the only critical-path flow that touches money. If it regresses we lose customers silently: the symptom is "the Start trial button does nothing" or "the Manage billing button 500s", neither of which surfaces in the existing smoke sweep, and neither of which any unit test catches today.

The previous 0d research doc (`docs/nightly-specs/2026-04-23-interaction-tests-critical-paths.md`) framed this as one big spec. The 0d.1 split moved each flow into its own file so a single flaky case doesn't hide the rest. This doc is the second of three remaining (after 0d.1 dismissal): it scopes 0d.2 narrowly, picks a redirect-boundary stopping point, and answers the open question the queue flagged about whether to add an `E2E_BYPASS_STRIPE` short-circuit.

The current implementation has shifted since the 0d parent spec was written: **the signup form does NOT redirect to Stripe Checkout**. `app/routes/auth/signup.tsx` (action) calls `ensureOrgForUser`, lands the org as `TRIALING` for 30 days, and redirects to the tenant board. The Stripe entry point lives at **`POST /api/billing/checkout`** (`app/routes/api/billing.checkout.ts`), called from the admin Billing page or the marketing /pricing page once the user is authed inside an org. So "signup → trial → checkout" is actually two redirects in two different routes, not one.

The spec below tests both legs without driving the Stripe hosted page.

## Current state

### Routes involved

- `app/routes/auth/signup.tsx` — three-step UI on the marketing host. Step 1 calls `signUp.email()` (better-auth, sets the session cookie via `POST /api/auth/sign-up/email`). Step 3 posts the form back to `/signup`'s action, which runs `ensureOrgForUser` and `redirect(tenantBoardUrl)`. **No Stripe call.** Org.status is `TRIALING`.
- `app/routes/api/billing.checkout.ts` — POST-only. Requires `user.orgId`. Rate-limited via `RL_BILLING`. Calls `createCheckoutSessionForOrg`, which lazily creates the Stripe customer (writes `Org.stripeCustomerId`) and returns the Checkout Session URL. The action then `throw redirect(url)` — Stripe URLs always start with `https://checkout.stripe.com/`.
- `app/routes/api/billing.portal.ts` — same shape, redirects to `https://billing.stripe.com/...`. Out of scope for 0d.2 (covered later in 0d follow-ups if needed).

### Stripe configuration surface

`app/domain/billing/stripe.server.ts` reads:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CAR_LINE_PRICE_ID` (or legacy `STRIPE_STARTER_PRICE_ID`)
- `STRIPE_CAMPUS_PRICE_ID`
- `STRIPE_CAR_LINE_ANNUAL_PRICE_ID` (optional)
- `STRIPE_CAMPUS_ANNUAL_PRICE_ID` (optional)

`requireStripeConfig` throws if any required key is missing. The dev binding pattern is documented in `wrangler.jsonc`. Staging already deploys with `env.staging` Stripe vars (the staging bucket/queue setup in AGENTS.md implies the same env block holds Stripe; verify in §"Open questions" #2 below).

### Existing fixtures and patterns

- `e2e/fixtures/seeded-tenant.ts` already exposes `tenant.adminCookie`, `tenant.marketingUrl(path)`, `tenant.tenantUrl(path)`, and (after 0d.1) a borrowed `tenant.db` libsql handle. The fixture seeds an `Org` with `billingPlan: "CAR_LINE"` and `status: "ACTIVE"` by default. **Important for 0d.2:** the trial-leg test wants to drive signup itself, NOT use a pre-seeded org; the checkout-leg test reuses the seeded fixture.
- `e2e/flows/signup-step-bounce.spec.ts` — already drives the real signup UI through step 1. Useful template for the trial-leg test.
- `e2e/flows/admin-roster.spec.ts`, `e2e/flows/viewer-pin.spec.ts` — show the seeded-tenant + cookie + tenantUrl pattern.
- `e2e/flows/dismissal.spec.ts` (0d.1 branch) — shows the pattern of asserting D1 state via `tenant.db` rather than rendering the public board.

### What does not exist

- No `e2e/flows/signup-to-paid.spec.ts` (the seeded-tenant fixture comment line 32 references it as if it existed; it does not).
- No `E2E_BYPASS_STRIPE` env flag — the queue's open-question #1 still open.
- No CI secret for Stripe test keys; the `e2e.yml` workflow does not currently inject `STRIPE_*`. Confirmed by reading the workflow path on master before this run.

## Proposal

Two test files. Both narrow, both stop at provable boundaries that don't require driving Stripe's hosted UI.

### File 1 — `e2e/flows/signup-to-paid.spec.ts`

**Two `test()` cases, both standalone (no `seeded-tenant` fixture — they own their own org creation):**

1. **`signup form creates a TRIALING org and lands the user on the tenant board`** — drives the real 3-step UI on the marketing host. Reuses the locator pattern from `signup-step-bounce.spec.ts`. Step 2 fills org name + slug, presses "Check availability", waits for the green confirmation, presses Continue. Step 3 presses "Start free trial". Asserts:
   - `await expect(page).toHaveURL(/^http:\/\/[a-z0-9-]+\.localhost:8787\//)` (redirected to a tenant subdomain).
   - The org row in D1 (looked up by the slug typed in step 2 via a temporary libsql client) has `status === "TRIALING"`, `billingPlan === "CAR_LINE"`, `trialEndsAt` ~30 days out.
   - **Cleanup:** the spec deletes the org + user + session + account it created in `test.afterEach`. Mirrors the seeded-tenant teardown logic (factor into a shared helper if convenient — see "File list" below).

2. **`POST /api/billing/checkout returns a redirect to checkout.stripe.com for an authed admin`** — uses the seeded-tenant fixture (admin already logged in, org already exists). Two sub-flavors gated on what's available in the runtime:
   - **If `STRIPE_SECRET_KEY` is set** — issue a `request.post(tenant.tenantUrl("/api/billing/checkout"))` with the admin cookie + form body `plan=CAR_LINE&billingCycle=monthly`. Set `maxRedirects: 0` and assert the response status is `302/303` and the `Location` header starts with `https://checkout.stripe.com/`. Also assert the org's `stripeCustomerId` is populated in D1 after the call (lazy-create side effect).
   - **If `STRIPE_SECRET_KEY` is NOT set** — `test.fixme()` with a clear message ("Stripe not configured in this environment; test requires STRIPE_SECRET_KEY + STRIPE_*_PRICE_ID + STRIPE_WEBHOOK_SECRET. See `docs/nightly-specs/2026-04-25-interaction-tests-signup-to-paid.md` § Open questions for the full list."). This keeps the spec usable on Noah's local machine with no Stripe creds without papering over the gap.

That's it — no third case for "user clicks success URL and lands back on the app" because that requires actually completing checkout.stripe.com, which we can't drive. Document that gap in the spec's header comment (per the queue's quality rule).

### Why no `E2E_BYPASS_STRIPE` flag

The queue's open-question #1 asks whether we should add `E2E_BYPASS_STRIPE` behind `app/domain/billing/checkout.server.ts` so the action returns a synthetic URL. Recommendation: **defer**. Reasons:

- The synthetic URL doesn't actually verify the Stripe wiring (price IDs valid, customer created, metadata attached). A green "bypass" test gives false confidence.
- The two regressions we actually fear — *"requireStripeConfig throws on staging because a price ID was renamed"* and *"the action redirects somewhere else by accident"* — both surface from the real call.
- If CI flakiness from Stripe rate limits ever becomes a problem, revisit. Until then a per-spec `test.fixme` on missing creds + a green run on staging is enough.

If Noah disagrees and wants the bypass, the implementation is small: read `env.E2E_BYPASS_STRIPE === "1"` at the top of `createCheckoutSessionForOrg`, return `{ url: "https://e2e.bypass.stripe/" + crypto.randomUUID() }`. Gate it behind `env.ENVIRONMENT !== "production"` so it can never ship to prod.

### Why drive the real signup UI for case 1

The signup-step-bounce regression (2026-04-23-2317) was a UI-only bug — the action worked, the React effect was wrong. Posting directly to the action would have hidden it. Driving the real UI keeps the test honest about what a customer experiences.

The cost (~6s of test time) is acceptable because there's only one trial-leg case.

## File list

### New files

- **`e2e/flows/signup-to-paid.spec.ts`** (new) — the two cases above. Estimated ~140 lines including header comment + cleanup helpers.

### Modified files

- **`e2e/fixtures/seeded-tenant.ts`** (modify, optional) — extract the `teardownSeedRows` body into an exported helper `teardownOrgById(db, orgId, userId)` so the trial-leg test can call it without copying the FK-ordered DELETE list. ~10 LOC change. Keeps the source of truth in one place when the schema evolves.
- **`docs/nightly-queue.md`** (modify) — flip 0d.2 to `[x]` once the build agent merges this. (Polish agent does NOT do this — that's the next build's responsibility.)
- **`docs/nightly/2026-04-25-polish.md`** (new, this polish run) — summary of this research.

### Files NOT touched

- No production code (`app/`, `workers/`, `prisma/`).
- No CI workflow (`e2e.yml`) — the spec is conditional on Stripe creds, so it doesn't *require* the workflow to inject them tonight. Adding Stripe test secrets to GitHub Actions is a separate workstream — flag it as a follow-up but don't bundle it in.
- No `playwright.config.ts` change — the existing `chromium-desktop` project picks up new files automatically.

## Testing approach

Run order on the build agent's worktree:

1. `npm test` — no impact (unit suites unaffected).
2. `npx playwright test e2e/flows/signup-to-paid.spec.ts --project=chromium-desktop` against `wrangler dev`:
   - With Stripe creds in `.dev.vars`: both cases run.
   - Without: trial leg runs, checkout leg `fixme`s.
3. `npm run typecheck` — verifies the exported `teardownOrgById` (if added) typechecks.
4. `playwright e2e/smoke.spec.ts --config=playwright.staging.config.ts` — staging gate per AGENTS.md. Should pass (the new spec runs only in the chromium-desktop project local to this branch; no staging-side change).

**Local sanity check Noah can run:**

```bash
# Optional: set Stripe test creds so the checkout leg actually runs
echo 'STRIPE_SECRET_KEY=sk_test_...' >> .dev.vars
echo 'STRIPE_CAR_LINE_PRICE_ID=price_...' >> .dev.vars
echo 'STRIPE_CAMPUS_PRICE_ID=price_...' >> .dev.vars
echo 'STRIPE_WEBHOOK_SECRET=whsec_...' >> .dev.vars

npx playwright test e2e/flows/signup-to-paid.spec.ts --project=chromium-desktop
```

Expected without Stripe creds: 1 pass + 1 fixme. With creds: 2 pass.

## Open questions

1. **Should we add `E2E_BYPASS_STRIPE`?** Recommendation in this spec is no (above). Build agent can implement either way — if Noah leaves a `[bypass: yes]` note on the queue item before the build runs, switch.
2. **Are Stripe test keys available in `env.staging`?** I couldn't verify from the docs visible in this read-only run. If they aren't, the staging smoke gate would skip the checkout leg too, which is fine but worth knowing. Build agent should check `wrangler.jsonc > env.staging > vars` (Stripe keys live in `vars` for non-secret price IDs and in secrets via `wrangler secret` for the keys themselves) and document the answer in the build summary.
3. **Should the trial-leg test use the seeded-tenant fixture's PIN/HomeRoom seeding, or really start from zero?** Recommendation: zero, because that's what a real user does. The seeded-tenant fixture pre-creates an Org which would make the test's slug-availability check trip (slug already exists). Easier to spin up a one-off `signup-${shortSlug}` per test.
4. **CI Stripe secrets.** Do we want to invest in setting up Stripe test keys in GitHub Actions secrets so CI also runs the checkout leg? Out of scope for the build agent picking up 0d.2 — file as a follow-up queue item ("ci-stripe-test-secrets") if Noah wants it.
5. **Cleanup safety.** The trial-leg test creates an `Org` with a randomly generated slug; if the test crashes mid-run the Org persists in `dev.db`. The seeded-tenant fixture handles this by best-effort teardown in a `finally`. The new spec must use the same pattern (`test.afterEach` with a try/catch). Worth a code-review eye during the build.

## Acceptance criteria for the build agent

- New file `e2e/flows/signup-to-paid.spec.ts` exists and runs (two cases as scoped above).
- Trial-leg case is **green** when run against `wrangler dev` with no Stripe creds.
- Checkout-leg case is **green** when run with valid `STRIPE_*` creds in `.dev.vars`; `test.fixme` (with the message above) when not.
- Typecheck passes (`npm run typecheck`).
- Unit tests pass (`npm test`).
- The spec deletes any rows it created on success AND on failure (no `dev.db` pollution that breaks the next run's slug uniqueness).
- Build summary documents whether the checkout leg ran (i.e., whether Stripe was configured in the sandbox), and lists any bug surfaced per the queue's quality rule.
