# Nightly Agent Queue

This file is the single source of truth for autonomous overnight agents. Each workstream has a status marker and an inline spec. Agents pick the first `[ ]` (queued) item whose deps are met, implement it on a branch, and mark it `[x]` when done.

**Status legend:**
- `[ ]` queued — ready to pick up
- `[→]` in progress — a current-night agent is working it
- `[x]` done — shipped on a branch awaiting Noah's review
- `[!]` blocked — reason logged inline; do not pick

**Hard rules for agents:**
- Never commit to `master`. Always work on `nightly-build/YYYY-MM-DD-{slug}` or `nightly-research/YYYY-MM-DD-{slug}`.
- DO push the feature branch to `origin` and open a **draft PR** against `master` via `gh pr create --draft`. The repo already has CI (`.github/workflows/ci.yml`, `e2e.yml`) that runs on PRs.
- If `gh` or `git push` auth fails, keep the branch local and flag it in the summary — Noah can push/PR manually in the morning.
- Never delete source files outside the workstream's scope.
- One workstream per run (build agent). One test pass + one research ticket (polish agent).
- When finished, write a summary to `docs/nightly/YYYY-MM-DD-{build|polish}.md` with the PR URL if one was opened.

---

## Priority 0 — Test & CI coverage (start here tonight)

### 0a. `[x]` smoke-test-sweep — Playwright smoke test for every route (done 2026-04-21, build agent; 2 bugs flagged as `test.fixme`, see docs/nightly/2026-04-21-build.md)

**Why:** Noah wants "every page works" confirmation. A smoke sweep that visits every route and asserts no 500 + key text present gives us that baseline before we invest in deeper tests. Any page that fails flags a real bug.

**Scope:**
- New file: `e2e/smoke.spec.ts`.
- Enumerate every route by reading `app/routes.ts` (plus filesystem under `app/routes/`). Group into: public marketing (/, /pricing, /faqs, /contact, /signup, /login), tenant-authed admin (/admin, /admin/users, /admin/children, /admin/fire-drill, /admin/history, /admin/branding, /admin/billing), tenant-authed controller (/, /update/$space, /empty/$space), and viewer pages.
- Use a seeded test tenant + test user created in a `beforeAll`. The e2e config (`playwright.config.ts`) already launches wrangler dev.
- For each route, assert: HTTP 200, key landmark text present, no console errors above `warn` severity.
- Skip dynamic `$param` routes that need real data unless we seed it.
- Keep this as a single file; split later if it grows.

**Out of scope:** deep interaction testing. That's workstream 0b.

---

### 0b. `[x]` mobile-smoke-sweep — Same sweep at iPhone + Android viewports (done 2026-04-22, build agent; merged to master as f87afe0)

**Depends on:** 0a.

**Scope:**
- `e2e/smoke.mobile.spec.ts` — run the same route enumeration under Playwright's `devices["iPhone 13"]` and `devices["Pixel 7"]` projects.
- Extend `playwright.config.ts` with mobile projects if not already present.
- Primary concern: the board grid doesn't overflow, the mobile caller view renders, the admin sidebar opens as a drawer.

---

### 0c. `[x]` ci-playwright-matrix — CI runs mobile + desktop projects (done 2026-04-23; landed from nightly-build/2026-04-22-0c-ci-playwright-matrix as f4d11b6)

**Depends on:** 0b.

**Scope:**
- Update `.github/workflows/e2e.yml` to run Playwright with both desktop + mobile projects (or add a matrix).
- Cache the playwright browsers (already done for chromium — extend to webkit if iOS emulation needs it; otherwise Chromium-only iPhone viewport is fine).
- Keep total CI time under 15 minutes.

---

### 0d. `[→]` interaction-tests-critical-paths — Deeper e2e on user journeys

**Depends on:** 0a passing.

**Scope:** write e2e specs for the critical paths, one file each:
- `e2e/flows/signup-to-paid.spec.ts` — signup → trial → stripe checkout (test mode) → back on app
- `e2e/flows/admin-roster.spec.ts` — create homeroom → create student → assign space number
- `e2e/flows/dismissal.spec.ts` — controller activates space → viewer sees it → empty it → history logs it
- `e2e/flows/viewer-pin.spec.ts` — viewer PIN gate → correct PIN → sees board → wrong PIN rate-limits
- `e2e/flows/branding-upgrade-gate.spec.ts` — FREE user sees upsell for logo + custom domain; CAMPUS user sees inputs.

**Quality rule (IMPORTANT):** if a test reveals unexpected behavior (a real bug), do NOT paper over it with a matching assertion. Flag it in the summary under "bugs found during testing" and leave the test `.fixme` or `.skip` with a comment. Codifying a bug as "passing" is worse than no test.

**Progress (2026-04-23-manual-1438):** foundation + two specs shipped on `nightly-build/2026-04-23-manual-1438`:
- `e2e/fixtures/seed-helpers.ts` — shared PBKDF2 / id primitives.
- `e2e/fixtures/seeded-tenant.ts` — `test.extend()` fixture that stands up a per-spec Org + admin Session + AppSettings + HomeRoom + Space, returns an `adminCookie` ready to add to the browser context.
- `e2e/flows/admin-roster.spec.ts` — create-student happy path + unknown-homeroom rejection.
- `e2e/flows/viewer-pin.spec.ts` — correct PIN / wrong PIN / attempts-counter.

Remaining work is split into 0d.1 / 0d.2 / 0d.3 so a flaky single flow doesn't block the others. Flip 0d to `[x]` once all three sub-items land.

---

### 0d.1. `[ ]` interaction-tests-dismissal — Controller/viewer/history loop spec

**Depends on:** `e2e/fixtures/seeded-tenant.ts` (landed in 0d partial).

**Scope:**
- New file: `e2e/flows/dismissal.spec.ts`.
- Seeded admin POSTs `/update/:space`, asserts `Space.status` flipped to `ACTIVE` (via a second browser context on `/` or via the fixture's libsql client).
- POSTs `/empty/:space`, asserts the space returns to `EMPTY` and `/admin/history` shows the call event.
- `BINGO_BOARD` Durable Object state survives across specs on the same wrangler dev — extend the fixture with an explicit `resetBoardForSpace(slug, spaceNumber)` teardown helper (open-question #3 in the research spec).

---

### 0d.2. `[ ]` interaction-tests-signup-to-paid — Signup → Stripe Checkout redirect spec

**Depends on:** `e2e/fixtures/seeded-tenant.ts` landed.

**Scope:**
- New file: `e2e/flows/signup-to-paid.spec.ts`.
- Unauthenticated visitor posts the signup form on the marketing host, follows through to the billing trigger, asserts the response redirect starts with `https://checkout.stripe.com/`. Does NOT drive the hosted Stripe page.
- If Noah prefers a full Stripe test-card path later, add an `E2E_BYPASS_STRIPE` flag behind `app/domain/billing/checkout.server.ts` (open-question #1 in the research spec). Default for now: stop at the redirect boundary.

---

### 0d.3. `[ ]` interaction-tests-branding-gate — Plan-gated branding admin spec

**Depends on:** `e2e/fixtures/seeded-tenant.ts` landed.

**Scope:**
- New file: `e2e/flows/branding-upgrade-gate.spec.ts`.
- Two subtests driving the seeded-tenant fixture with different `billingPlan` project metadata:
  1. `CAR_LINE` admin on `/admin/branding` sees the "Upgrade to Campus" upsell + no logo/custom-domain inputs.
  2. `CAMPUS` admin on `/admin/branding` sees the real logo upload + custom-domain input.
- The fixture currently reads `testInfo.project.metadata.tenantBillingPlan`; add two tagged subtests (or per-test project overrides) to toggle between them.

---

## Priority 1 — Pilot blockers

### 1. `[ ]` roster-csv-import — Bulk student import via CSV/XLSX

**Why:** Biggest onboarding friction. A school cannot hand-enter 400 students via `app/routes/create/create.student.tsx` one at a time. This unblocks every pilot conversation.

**Scope:**
- New admin route: `app/routes/admin/roster-import.tsx`
- Accept a CSV or XLSX upload. Required columns: `firstName`, `lastName`, `homeRoom`. Optional: `spaceNumber`, `grade`, `guardianEmail`.
- Parse via SheetJS (already on the frontend whitelist — but this is server-side; use a lightweight CSV parser for CSV and `xlsx` npm package for XLSX if not already installed).
- Show a preview table with first 25 rows + validation errors per row.
- Dedupe logic: match on `firstName + lastName + homeRoom` within the tenant. New rows insert; matches update; empty required fields reject.
- On confirm, batch insert via `prisma.student.createMany` with a transaction.
- Downloadable template CSV link at top of the page.
- Plan gating: available on all plans (not CAMPUS-gated).
- Sidebar link: add to `app/components/admin/AdminSidebar.tsx` between "Children & Classes" and "Fire drill". Icon: `Upload` from lucide-react.
- Route registration in `app/routes.ts`.

**Out of scope:** teacher/homeroom CSV import, family/guardian import, CSV export from roster-import page (already exists in history).

---

### 2. `[!]` legal-pages — Privacy, Terms, Student Data Addendum

**Blocked pending Noah's inputs:** legal entity name, state of incorporation, support email for privacy requests, jurisdiction for disputes, whether to adopt the SDPC standard DPA template (https://sdpc.a4l.org). Polish agent can pre-draft the page structure and fetch the SDPC template into `docs/nightly-specs/legal-pages.md` as research.

---

### 3. `[ ]` support-contact — Contact form + footer link

**Why:** No way to reach support today. Minimum viable: a form that posts to the existing email send pipeline.

**Scope:**
- New public route: `app/routes/contact.tsx`. Fields: name, email, school name (optional), message, topic (select: Sales / Support / Bug / Other).
- On submit: send to the support email (pull from `getSupportEmail(context)` in `~/lib/site`). Rate-limit to 1 per IP per 60s using the existing rate-limiting doc patterns under `docs/rate-limiting.md`.
- Render a success/failure state on the same page.
- Add "Contact" link to the marketing nav/footer (look at `app/components/marketing/MarketingNav.tsx` and `app/components/Footer.tsx`).

---

### 4. `[ ]` ops-runbook — Dismissal-time operational runbook

**Why:** A 3pm outage kills reputation. We need a written fallback before anyone depends on the app.

**Scope (docs only, no code):**
- `docs/ops-runbook.md` covering: pre-deploy checklist, rollback procedure (Cloudflare Workers rollback), how to force-failover to the print master list, on-call escalation, critical metrics to watch (latency of `/healthz`, websocket connection count, error rate in Sentry), contact tree.
- Also write `docs/dismissal-day-checklist.md` — one-pager a school admin prints and keeps at the front desk: "what to do if the app is down during dismissal."

---

## Priority 2 — Close-the-deal

### 5. `[ ]` data-export-delete — Admin "export" and "delete org" flows

**Scope:**
- `app/routes/admin/data-export.tsx` — button that streams a zip of JSON files: `students.json`, `teachers.json`, `spaces.json`, `call-events.json`, `users.json`. Campus+ plan gated via `planAllowsReports` pattern. Log the export to `OrgAuditLog`.
- `app/routes/admin/data-delete.tsx` — "delete all org data" flow. Double confirmation (type the org slug). Hard-deletes students/teachers/spaces/callEvents/families. Keeps the org row + stripe for billing continuity. Logs to audit.

---

### 6. `[ ]` uptime-monitor — External uptime monitoring

**Scope (research + config, not code):**
- `docs/nightly-specs/uptime-monitor.md`: compare UptimeRobot / BetterStack / Cronitor for our needs (10 tenants × 2 routes = ~20 checks, cheap tier).
- Pre-draft the checks: `/`, `/healthz`, `{tenant}.pickuproster.com/` (for a test tenant).
- Document how to wire alerts to email/Slack.
- Actual account signup is a Noah-action, not an agent action.

---

### 7. `[ ]` demo-sandbox — Read-only demo tenant

**Why:** Landing-page visitors should be able to try the board without signing up.

**Scope:**
- Seed script (or Prisma seed call) creating an org with slug `demo`, 30 students, 4 homerooms, 30 spaces.
- A cron task (Worker scheduled) that cycles spaces between ACTIVE/EMPTY so the board looks alive.
- `/demo` route on the marketing host that redirects to `demo.pickuproster.com/` OR an iframe-embed of the demo.
- "Try a live demo" CTA on the landing page.

---

### 8. `[ ]` onboarding-wizard — Post-signup guided setup

**Depends on:** roster-csv-import being in place.

**Scope:**
- `app/routes/onboarding/*` multi-step: 1) confirm school name, 2) upload roster, 3) add/verify homerooms, 4) set viewer PIN, 5) preview board, 6) invite staff.
- Skip/resume per step. Persist progress on the org row (`onboardingStep: string?`).
- Show onboarding banner on the admin dashboard until complete.

---

## Priority 3 — Scale & polish

### 9. `[ ]` analytics-funnel — PostHog or Plausible

**Scope (research first — write spec):**
- `docs/nightly-specs/analytics-funnel.md`: PostHog vs Plausible decision matrix for our needs (marketing pageviews + app-event funnel: signup-start, signup-complete, trial-to-paid, first-call-event).
- Recommended: PostHog (free tier covers us; supports server-side events from Cloudflare Workers).
- Then: install, set env vars, emit events. Respect DNT. No PII beyond orgId/userId hash.

---

### 10. `[ ]` marketing-og-images — OG images, sitemap, robots.txt

**Scope:**
- OG image generator route: `app/routes/og/$slug.tsx` using `@vercel/og` or equivalent Workers-compatible lib (research Workers compat first — vercel/og may not work on CF Workers; consider `satori` + `resvg-wasm`).
- `app/routes/sitemap.xml.tsx`, `app/routes/robots.txt.tsx`.
- Per-route meta: OG image URL, canonical, description.
- For tenant hosts, robots.txt should `Disallow: /` so staff boards aren't indexed.

---

### 11. `[!]` parent-family-app — Parent/guardian viewer (Campus feature)

**Blocked:** This is vaporware on the pricing page. Too big for one night; needs a full product spec. Polish agent should draft `docs/nightly-specs/parent-family-app.md` with: auth model (magic link vs passworded), features (see my kid's pickup status, notify me when called, family association), routes, and data model changes. Then Noah decides whether to build it or remove from the Campus tier list.

---

## Priority 4 — Code health (agent can grab when idle)

### 12. `[ ]` playwright-coverage-expansion — e2e tests for existing admin routes

**Scope:** Currently e2e only covers auth + marketing. Add specs for: creating a student, activating a space, viewing history, editing branding.

### 13. `[ ]` heroui-migration-cleanup — Close out the migration report

**Scope:** Read `app/heroui-migration-report.md` (the migration report in the repo). Address any remaining items. Delete the report when it's done.

---

## How to add new workstreams

Append to the appropriate priority section with a `[ ]` status, a slug, a one-line summary, and an inline scope. If research is needed first, note the polish agent should draft a spec in `docs/nightly-specs/{slug}.md`.

---

## [research: 2026-04-23]

- multi-child-batch-ops: One control to apply a dismissal-plan change (early pickup, after-care, sub-driver) to N children at once — direct response to SDM's most-cited parent-app weakness. Source: docs/research/2026-04-23-schools.md.
- recurring-exception-templates: Set "Mom Mon/Wed, Dad Tue/Thu, after-care Fri" once and let it apply forever with easy override; SDM and PikMyKid users explicitly call out the lack of this. Source: docs/research/2026-04-23-schools.md.

---

## [research: 2026-04-23-manual-1438]

From `docs/research/2026-04-23-manual-1438-schools.md` (safety-drill / accountability / reunification angle). Three strong hypotheses sized S–M worth queueing:

### R1. `[ ]` drill-accountability-roster — "Who is with whom, right now" during drills

**Why:** Every direct competitor (Ruvna, Raptor, CrisisGo) leads with this claim; paper clipboards still dominate. Reuses our existing `organization → child → guardian` model almost unchanged. See TL;DR + Signals in the research brief.

**Scope (research first — write spec):**
- `docs/nightly-specs/drill-accountability-roster.md`: data model for per-classroom rosters + real-time check-in status; silent-mode UI spec (see R2); incident-commander dashboard that aggregates "checked in" vs "missing" across rooms.
- Decide: reuse `fireDrill`/`drill-templates-proposal.md` primitives or model as new `accountability-session` entity.
- Integration surface with SIS imports (if any; otherwise just our own roster).
- Build size: M.

### R2. `[ ]` silent-lockdown-mode — One-hand, dark-UI, silent roster for lockdown drills

**Why:** Best-practice docs (Texas SSC SRP toolkit, BeSafe) explicitly require silent/discreet attendance during lockdown. No competitor has a UI designed for under-the-desk, one-hand operation with zero sound/vibration/push.

**Scope:**
- New mode triggered when admin selects SRP "Lockdown" action (presupposes R1).
- Dark theme, large tap targets, full-screen roster, zero audio/haptics, no system push notifications to the teacher's device while the mode is active.
- Works offline — last-known roster cached — and syncs when network returns.
- Build size: S.

### R3. `[ ]` compliant-drill-log-export — One-click state-compliant drill logs

**Why:** MI, GA, CA all have concrete annual requirements; CT SB 298 (Mar 2026) adds trauma-informed drill + advance-parent-notice requirements with documentation. Michigan requires posting drill records on the school website within 30 days and retaining 3 years. A product that prints this log out of the box is an admin-sale unlock on top of R1.

**Scope (research first — write spec):**
- `docs/nightly-specs/compliant-drill-log-export.md`: inventory per-state required fields (start with MI, GA, CA, CT, NY — 5 highest-signal states), map to our drill data model, design one template per state, PDF + CSV export, optional auto-post to a public page for MI-style publishing rules.
- Build size: S–M.

