# Research spec — 0d.3 interaction-tests-branding-gate

**Author:** polish agent, 2026-04-26.
**Workstream:** Priority 0, item 0d.3 in `docs/nightly-queue.md`.
**Status:** research only — no code changed in this run.
**Depends on:** `e2e/fixtures/seeded-tenant.ts` (landed 2026-04-23-manual-1438).
**Companion to:** the 0d.1 spec landed 2026-04-24, the 0d.2 spec landed 2026-04-25 (build-blocked, branch pushed for review).

---

## Problem

`/admin/branding` is the only admin route that materially changes shape based on `Org.billingPlan`. FREE / CAR_LINE / STARTER tenants see a colors-only form plus an "Upgrade to Campus" upsell; CAMPUS / DISTRICT / ENTERPRISE tenants additionally see a logo-upload `<input type="file">` and a custom-domain text input. The gate is enforced **twice**:

1. UI (`app/routes/admin/branding.tsx` ~line 341): `loaderData.advancedBrandingAllowed` toggles the entire `<>…<input name="logo" />…<input name="customDomain" />…</>` block versus the upsell `<div>` with a "Upgrade to Campus" link.
2. Server (`app/routes/admin/branding.tsx` ~lines 84–93): even if a user crafts a `multipart/form-data` POST with `logo` or `customDomain` set, the action drops the inputs and returns `data({ error: t("branding.errors.advancedRequired") }, { status: 400 })`.

Both gates rely on `planAllowsAdvancedBranding(billingPlan)` from `app/lib/plan-limits.ts` — `CAMPUS | DISTRICT | ENTERPRISE` returns true; everything else returns false. That helper is unit-tested in `app/lib/plan-limits.test.ts`, but the **route-level integration** (loader returns the right shape; UI renders the right block; server rejects a crafted bypass) has no automated coverage today. A regression — accidentally inverting the boolean, dropping the wrapping `{advancedBrandingAllowed ? … : …}` ternary, removing the server-side reject — would ship silently because the smoke sweep only asserts a 200 + heading-present and the unit suite only covers the helper in isolation.

## Current state

### Routes + helpers

- **`app/routes/admin/branding.tsx`** — single-file route with `loader`, `action`, and a default React component. Loader returns `advancedBrandingAllowed: planAllowsAdvancedBranding(org.billingPlan)` and `billingPlan: org.billingPlan`. The component reads `loaderData.advancedBrandingAllowed` and conditionally renders either:
  - the **inputs block** (logo file picker + clearLogo checkbox + custom domain input + domainHelp), or
  - the **upsell block** (`<div>` with `branding.advancedTitle` + `branding.advancedBody` + `branding.advancedBodyExample` + a `<Link to="/admin/billing">` rendering the `branding.upgradeCampus` text — i.e. "Upgrade to Campus").
- **`app/lib/plan-limits.ts`** — `planAllowsAdvancedBranding(billingPlan)` returns true for `"CAMPUS" | "DISTRICT" | "ENTERPRISE"`, false otherwise. Already covered by `app/lib/plan-limits.test.ts`.
- **`app/domain/org/branding.server.ts`** — `validateLogoUpload`, `buildOrgLogoObjectKey`, `HEX_COLOR_RE`, default colors. The action calls `validateLogoUpload(logoFile)` before R2 upload; not relevant to the gate test (the gate fires before validation).

### Existing fixtures + patterns

- **`e2e/fixtures/seeded-tenant.ts`** — `test.extend()` fixture that inserts `Org + User + Account + Session + AppSettings + HomeRoom + Space` directly via `@libsql/client` against `dev.db`, returns `{orgId, slug, adminCookie, tenantUrl, marketingUrl, …}`. **Critically for 0d.3:** the fixture already supports a `billingPlan` seed option — line 117 declares `SeedOptions.billingPlan: "FREE" | "CAR_LINE" | "CAMPUS"` and lines 260–262 read it from `testInfo.project.metadata.tenantBillingPlan` (default `"CAR_LINE"`). Today **no Playwright project sets that metadata**, so the fixture is hardcoded to `CAR_LINE` in practice. 0d.3 needs a way for a single spec to switch between two plans for two adjacent tests — the project-metadata path doesn't fit, so the spec should add a fixture **option** instead (see Proposal below).
- **`e2e/flows/admin-roster.spec.ts`** — best template for the CAMPUS test case (admin authed via `tenant.adminCookie`, navigate to a `/admin/*` route, assert visible elements).
- **`e2e/smoke-routes.ts`** line 158 — already covers `/admin/branding` for "200 + heading present", which means a green smoke run does NOT prove the gate logic. 0d.3's specs are strictly additive.

### What does not exist

- No `e2e/flows/branding-upgrade-gate.spec.ts`.
- No fixture **option** for `tenantBillingPlan` — only the unused `testInfo.project.metadata` path. (The 0d parent spec at `docs/nightly-specs/2026-04-23-interaction-tests-critical-paths.md` § "Open question 4" flagged this exact gap.)
- No spec asserting the server-side bypass reject (the queue's quality rule strongly prefers we cover both UI gate + server gate; otherwise a regression that drops one gate but keeps the other passes the test).

### Implementation reality the build agent will hit

The fixture's `billingPlan` parameter goes straight into `INSERT INTO "Org" (… billingPlan, …) VALUES (…, ?, …)`. The seeded org has `status: 'ACTIVE'`, so a `CAMPUS` plan is immediately effective — no Stripe round-trip, no webhook simulation. That's the **right** behavior for 0d.3: we are testing the route gate, not the billing transition. A separate, future workstream covers the trial → paid → downgrade transition (touched in 0d.2 spec § "Why no E2E_BYPASS_STRIPE flag").

## Proposal

Two pieces of work, both narrowly scoped, both stop at proven boundaries.

### 1. Fixture option for `tenantBillingPlan`

Add a Playwright fixture **option** (named, overridable per `test.use({…})`) to `e2e/fixtures/seeded-tenant.ts` so a spec can set `billingPlan` per-describe without touching `playwright.config.ts`:

```ts
// e2e/fixtures/seeded-tenant.ts (proposed change, ~6 LOC)
type Fixtures = {
  tenant: SeededTenant;
};
type Options = {
  tenantBillingPlan: SeedOptions["billingPlan"];
};

export const test = base.extend<Fixtures, Options>({
  tenantBillingPlan: ["CAR_LINE", { option: true }],
  tenant: async ({ tenantBillingPlan }, use, testInfo) => {
    // … existing seed body, but replace the metadata read with:
    const opts: SeedOptions = { billingPlan: tenantBillingPlan };
    // (drop the testInfo.project.metadata?.tenantBillingPlan branch — superseded.)
    // …
  },
});
```

Spec usage pattern:

```ts
import { test, expect } from "../fixtures/seeded-tenant";

test.describe("admin on FREE plan sees upsell", () => {
  test.use({ tenantBillingPlan: "FREE" });
  test("…", async ({ page, tenant }) => { /* … */ });
});

test.describe("admin on CAMPUS plan sees inputs", () => {
  test.use({ tenantBillingPlan: "CAMPUS" });
  test("…", async ({ page, tenant }) => { /* … */ });
});
```

Why **option** rather than **per-test arg**: `test.use({…})` is the canonical Playwright way to switch fixture inputs per-block. It's also consistent with how Playwright docs recommend supplying tenant variants. The deprecated `testInfo.project.metadata.tenantBillingPlan` read can stay as a fallback for one release if Noah wants belt-and-suspenders, but recommendation is to remove it cleanly to avoid two ways of doing the same thing.

### 2. New spec — `e2e/flows/branding-upgrade-gate.spec.ts`

Three `test()` cases inside two `describe` blocks, ~150 lines incl. comments:

**Block A — `tenantBillingPlan: "FREE"`:**

1. **`FREE plan loads /admin/branding without logo + custom-domain inputs and shows the Upgrade-to-Campus upsell`**
   - `page.context().addCookies([tenant.adminCookie])`
   - `await page.goto(tenant.tenantUrl("/admin/branding"))`
   - Assert visible: `getByRole("heading", { name: /Branding/i })`, the colors fields (`getByLabel(/Primary color/i)`, `getByLabel(/Accent color/i)` or palette section).
   - Assert **not present:** `page.getByLabel(/^Logo \(/i)` (the `branding.logoLabel` "Logo (PNG, JPEG, WEBP up to 2MB)" label) — `await expect(page.getByLabel(/Logo \(/i)).toHaveCount(0)`.
   - Assert **not present:** `page.getByLabel(/Custom domain/i)` — same shape.
   - Assert **upsell present:** `await expect(page.getByText(/Logo upload & custom domain/i)).toBeVisible()` and the link `getByRole("link", { name: /Upgrade to Campus/i })` with `href === "/admin/billing"`.

2. **`FREE plan POST /admin/branding with logo file + customDomain is rejected with the advancedRequired error`**
   - Direct `request.post(tenant.tenantUrl("/admin/branding"))` with a `multipart/form-data` body that includes a tiny PNG `logo` field and a `customDomain=evil.test` field. Use Playwright's `multipart` shape: `request.post(url, { multipart: { brandColor: "#112233", brandAccentColor: "#445566", logo: { name: "x.png", mimeType: "image/png", buffer: <8-byte PNG header> }, customDomain: "evil.test" } })`.
   - Important: include the admin cookie via `page.request` after `page.context().addCookies(...)` OR build a `request.newContext({ extraHTTPHeaders: { cookie: serializeCookie(tenant.adminCookie) } })`.
   - Assert the response status (400) and that the response body contains the literal `"Custom domain and logo upload require the Campus or District plan."` from `public/locales/en/admin.json`.
   - Assert the org's `customDomain` in D1 was **not** updated — `await tenant.db.execute({ sql: "SELECT customDomain FROM \"Org\" WHERE id = ?", args: [tenant.orgId] })` should still be null/empty. (Add a `tenant.db` libsql handle export on the fixture if 0d.1 didn't already — see "File list" below.)

**Block B — `tenantBillingPlan: "CAMPUS"`:**

3. **`CAMPUS plan loads /admin/branding with logo + custom-domain inputs and no upsell`**
   - Same navigation as case 1, with `tenantBillingPlan: "CAMPUS"`.
   - Assert **present:** `getByLabel(/Logo \(/i)` (file input), `getByLabel(/Custom domain/i)` (text input).
   - Assert **upsell hidden:** `await expect(page.getByText(/Logo upload & custom domain/i)).toHaveCount(0)`.
   - Optional smoke: fill `customDomain=test.example.com`, submit, expect a 302 back to `/admin/branding` (success toast). Recommendation: include it — it's ~5 lines and proves the action accepts the input on CAMPUS.

**Quality rule:** if any assertion fails because of a real app bug, leave the test as a hard failure or `test.fixme(..., "<bug description>")` and call it out in the build summary. Do NOT rewrite the test to pass — codifying a buggy gate as "passing" is worse than no test.

## File list

### New files

- **`e2e/flows/branding-upgrade-gate.spec.ts`** — the three cases above (~150 lines incl. header comment + the multipart body builder).

### Modified files

- **`e2e/fixtures/seeded-tenant.ts`** — add the `tenantBillingPlan` option + remove the dead `testInfo.project.metadata?.tenantBillingPlan` read (~10 LOC change). If the build agent already exposed `tenant.db` for 0d.1, no further change; otherwise also add `db: LibsqlClient` to the `SeededTenant` type and `db` to the returned object so the spec can read back the customDomain column. Verify against the merged 0d.1 branch state before editing.
- **`docs/nightly-queue.md`** — flip 0d.3 to `[x]` once the build agent merges. (Polish agent does NOT do this — that's the next build's responsibility.)

### Files NOT touched

- No production code (`app/routes/admin/branding.tsx`, `app/lib/plan-limits.ts`, `app/domain/org/branding.server.ts`).
- No `playwright.config.ts` change — `chromium` project picks up new files automatically.
- No CI workflow change — the new spec runs under the existing chromium project on PRs.
- No i18n changes — assertions key off the existing English strings in `public/locales/en/admin.json`.

## Testing approach

Run order on the build agent's worktree:

1. `npm test` — verifies the unit suites are unaffected.
2. `npm run typecheck` — proves the fixture option type wires through.
3. `npx playwright test e2e/flows/branding-upgrade-gate.spec.ts --project=chromium` against `wrangler dev`:
   - Expected: 3 pass.
   - The test runs in <10s total (no network beyond localhost, no R2 upload, no Stripe).
4. `npx playwright test e2e/flows/admin-roster.spec.ts e2e/flows/viewer-pin.spec.ts --project=chromium` — regression check that the fixture option change didn't break the existing flow specs (they should still default to `CAR_LINE`).
5. `npm run deploy:staging` + `npx playwright test e2e/smoke.spec.ts --config=playwright.staging.config.ts` — staging gate per AGENTS.md. The new spec runs only against `wrangler dev`, not against staging (the libsql direct-write seeding doesn't apply to a remote D1), so smoke staging stays green-on-green and the new spec is local-CI only.

**Local sanity check Noah can run:**

```bash
npm install
npm run dev       # in another terminal — boots wrangler dev on :8787
npx playwright test e2e/flows/branding-upgrade-gate.spec.ts --project=chromium --headed
```

Expected: 3 pass.

## Open questions

1. **Should the fixture's old `testInfo.project.metadata.tenantBillingPlan` path stay as a fallback?** Recommendation: drop it. It's never wired up in `playwright.config.ts`, so it's dead code — leaving two ways to set the same thing invites confusion later. Build agent: just remove it.
2. **Does the bypass-reject test need a real PNG body, or is `Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])` (the 8-byte PNG signature) enough?** The 8-byte signature is enough — the action rejects on the plan gate **before** `validateLogoUpload` runs, so the file body never reaches the validator. Use the 8-byte buffer to keep the spec hermetic.
3. **Does the seeded-tenant fixture currently expose a `db` libsql handle for spec-side D1 reads?** The 0d.2 spec at `docs/nightly-specs/2026-04-25-interaction-tests-signup-to-paid.md` § File list assumes 0d.1 added one. Verify against the merged 0d.1 branch — if it's there, use it; if not, add it as part of this workstream (4 LOC). Either way the build agent should NOT spin up a second libsql client per spec; share the fixture's.
4. **Should we also test the `DISTRICT` and `ENTERPRISE` plans?** Recommendation: no, not in 0d.3. The helper-level test already covers all four allowed values. The 0d.3 spec exists to prove the **route wiring** is correct — one allowing plan + one denying plan is sufficient. Adding two more cases triples test time for negligible signal.
5. **Does the action's reject path return JSON or HTML?** It uses `data({ error: ... }, { status: 400 })`, which is React Router's `data()` helper. The string `"Custom domain and logo upload require the Campus or District plan."` ends up in the rendered HTML where the `domainError` state surfaces it. The bypass-reject test should assert `await response.text()` contains that literal — simpler and more robust than parsing a JSON envelope that may not exist.
6. **CAMPUS submit: do we need to clean up the `customDomain` row after the optional submit case in test 3?** Yes — the seeded-tenant teardown deletes the `Org` row at the end, which cascades. No additional cleanup needed.

## Acceptance criteria for the build agent

- New file `e2e/flows/branding-upgrade-gate.spec.ts` exists and runs (three cases as scoped above).
- All three cases are **green** when run against `wrangler dev`. No `test.fixme` unless a real app bug surfaces, in which case follow the queue's quality rule.
- `e2e/fixtures/seeded-tenant.ts` exposes a working `tenantBillingPlan` option, default `CAR_LINE`. The dead `testInfo.project.metadata` read is removed.
- Pre-existing flow specs (`admin-roster`, `viewer-pin`, `dismissal`, `signup-to-paid` if it landed) still pass with the fixture change.
- Typecheck passes (`npm run typecheck`).
- Unit tests pass (`npm test`).
- The new spec leaves zero D1 rows behind on success or failure (relies on existing teardown).
- Build summary documents whether case 3's optional CAMPUS submit was included, and if any assertion surfaced a real app bug per the queue's quality rule.
