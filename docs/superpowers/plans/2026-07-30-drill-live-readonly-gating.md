# Live Drill Read-Only Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Magic-code guests watching a live drill get a genuinely read-only UI instead of interactive controls that blow the page away with a 401 error screen.

**Architecture:** The loader already computes `membership: "STAFF" | "VIEWER_PIN"` but never tells the client. Extract the write policy into a pure, testable module, return `canEdit` from the loader, and fold it into the component's existing `readOnly` flag. Every interactive control in the page already honours `readOnly` — so once the flag is right, the controls disable themselves. No changes to the action are needed (see "Why the action is already correct" below).

**Tech Stack:** React Router 7, Cloudflare Workers, TypeScript, `node --test` via `tsx`, i18next.

## Global Constraints

- Tests run with `npm test` (glob includes `app/domain/drills/*.test.ts`). No new test runner.
- Any `t("…")` key added to code MUST exist in **both** `public/locales/en/*.json` and `public/locales/es/*.json`, or `app/lib/i18n-keys.test.ts` fails the build.
- No dynamic imports of internal modules — static top-level imports only.
- Do not add manual revalidators; React Router re-runs loaders after every action.

## Background: what is actually broken

- `app/routes/drills.live.tsx:687` — `const readOnly = paused;` is the *entire* read-only signal. It describes the drill's state, never the caller's identity.
- The loader (`:82-91`) computes `membership` and throws 401 when it is `null`, but returns only `isAdmin` (`:207`).
- A VIEWER_PIN guest on an `EVERYONE` drill therefore renders fully interactive checklist cells, attest/issue buttons, a notes textarea, and follow-up items. Each write calls `persist()` → `fetcher.submit` → the action's `if (!user) throw new Response("Not authenticated", { status: 401 })` (`:236-238`).
- `drills.live.tsx` exports no `ErrorBoundary`, so that 401 bubbles to the root boundary (`app/root.tsx:243`) and **replaces the whole drill display with "Not Logged In"** mid-drill.

### Why the action is already correct (do not "fix" it)

`update-state` has no role check, which looks like a hole but is not. `app/domain/teachers/teacher-import.server.ts:16` types the importable roles as `"VIEWER" | "CONTROLLER"` — imported classroom teachers ordinarily carry `User.role === "VIEWER"`. That account is exactly who must attest their own room during a drill. Gating `update-state` on `ADMIN|CONTROLLER` would break the primary use case drills exist for.

The correct policy is therefore **any signed-in org member may edit; magic-code guests may not** — which the action already enforces via its `!user` 401. Task 1 adds a comment so the client and server policies do not drift, and nothing more.

Admin-only lifecycle controls (pause/resume/end) are already correct on both sides: hidden behind `isAdmin &&` at `:1139` / `:1293`, re-checked by `requireAdmin()` at `:255`. Leave them alone.

---

### Task 1: Extract the drill write policy

**Files:**
- Create: `app/domain/drills/edit-policy.ts`
- Create: `app/domain/drills/edit-policy.test.ts`
- Modify: `app/routes/drills.live.tsx:390` (comment only)

**Interfaces:**
- Produces: `canEditDrillRun(membership: AudienceMembership): boolean` — consumed by Task 2's loader.
- Consumes: `AudienceMembership` from `app/domain/drills/live-redirect.server.ts` (existing export: `"STAFF" | "VIEWER_PIN" | "NONE"`).

- [ ] **Step 1: Write the failing test**

Create `app/domain/drills/edit-policy.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { canEditDrillRun } from "./edit-policy";

test("signed-in staff may write to a live drill", () => {
  assert.equal(canEditDrillRun("STAFF"), true);
});

test("magic-code guests may watch but never write", () => {
  assert.equal(canEditDrillRun("VIEWER_PIN"), false);
});

test("anonymous callers may not write", () => {
  assert.equal(canEditDrillRun("NONE"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test app/domain/drills/edit-policy.test.ts`
Expected: FAIL — `Cannot find module './edit-policy'`.

- [ ] **Step 3: Write minimal implementation**

Create `app/domain/drills/edit-policy.ts`:

```ts
import type { AudienceMembership } from "./live-redirect.server";

/**
 * May this caller write to a live drill run — checklist cells, classroom
 * attestations, notes, and follow-up items?
 *
 * Any signed-in org member may. That deliberately includes
 * `User.role === "VIEWER"`: `teacher-import.server.ts` assigns imported
 * classroom teachers either "VIEWER" or "CONTROLLER", so a VIEWER-role
 * account is the ordinary shape of a teacher — and attesting their own room
 * is the primary reason drills exist. Narrowing this to ADMIN/CONTROLLER
 * would lock teachers out of the one action they are here to perform.
 *
 * Magic-code guests (VIEWER_PIN) hold no `User` row. They may watch an
 * EVERYONE drill, but never write to it.
 *
 * Lifecycle actions (pause / resume / end) are a *separate*, stricter gate —
 * see `requireAdmin()` in `app/routes/drills.live.tsx`.
 */
export function canEditDrillRun(membership: AudienceMembership): boolean {
  return membership === "STAFF";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test app/domain/drills/edit-policy.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Point the action's 401 at the policy**

In `app/routes/drills.live.tsx`, find the `update-state` branch (`:390`) and add a comment above it. Change:

```ts
    if (intent === "update-state") {
      const raw = String(formData.get("state") ?? "");
```

to:

```ts
    if (intent === "update-state") {
      // Write gate lives in the `!user` 401 at the top of this action, which
      // is the server-side twin of `canEditDrillRun` in
      // `app/domain/drills/edit-policy.ts`. Any signed-in org member may
      // write (teachers usually carry role "VIEWER"); guests hold no User
      // row and are rejected there. Keep the two in step.
      const raw = String(formData.get("state") ?? "");
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, with 3 more tests than the previous baseline.

- [ ] **Step 7: Commit**

```bash
git add app/domain/drills/edit-policy.ts app/domain/drills/edit-policy.test.ts app/routes/drills.live.tsx
git commit -m "feat(drills): extract live-drill write policy into a testable module"
```

---

### Task 2: Make the guest UI actually read-only

**Files:**
- Modify: `app/routes/drills.live.tsx` — loader (`:119`, `:207`), component destructure (`:532`), `readOnly` (`:687`)

**Interfaces:**
- Consumes: `canEditDrillRun` from Task 1.
- Produces: loader payload field `canEdit: boolean`, consumed by Task 3's banner.

- [ ] **Step 1: Compute `canEdit` in the loader**

In `app/routes/drills.live.tsx`, add the import alongside the existing viewer-access import at `:50`:

```ts
import { canEditDrillRun } from "~/domain/drills/edit-policy";
```

Then, immediately after the `isAdmin` computation (`:119-120`), add:

```ts
  // Guests hold no User row: they watch, they never write. Drives the
  // component's `readOnly` flag so the controls are inert rather than
  // interactive-then-401.
  const canEdit = canEditDrillRun(membership);
```

- [ ] **Step 2: Return it from the loader**

In the loader's return object, change (`:207`):

```ts
    isAdmin,
    paused,
```

to:

```ts
    isAdmin,
    canEdit,
    paused,
```

- [ ] **Step 3: Consume it in the component**

Change the destructure at `:532`:

```ts
  const { run, template, isAdmin, paused, me, recentActivity } = loaderData;
```

to:

```ts
  const { run, template, isAdmin, canEdit, paused, me, recentActivity } = loaderData;
```

- [ ] **Step 4: Fold it into `readOnly`**

Change `:687`:

```ts
  const readOnly = paused;
```

to:

```ts
  // Two independent reasons the page is inert: the drill is paused (state),
  // or the caller may not write (identity). Every control below —
  // ChecklistTable cells and attest buttons, the notes textarea, follow-up
  // add/remove — already honours this one flag.
  const readOnly = paused || !canEdit;
```

- [ ] **Step 5: Typecheck**

Run: `npx react-router typegen && npx tsc --noEmit`
Expected: no errors. (If `+types/drills.live` is reported missing, the typegen step above is the fix.)

- [ ] **Step 6: Verify no write path bypasses the flag**

Run: `rg -n "fetcher\.submit|persist\(" app/routes/drills.live.tsx`
Expected: every hit is inside a callback that begins `if (readOnly) return;`, or is the admin-only lifecycle `<Form>` at `:1293` (which is separately gated by `isAdmin &&` and `requireAdmin()`). If any other write path exists, add the `if (readOnly) return;` guard to it before continuing.

- [ ] **Step 7: Commit**

```bash
git add app/routes/drills.live.tsx
git commit -m "fix(drills): make the live drill read-only for magic-code guests

Guests rendered fully interactive checklist, attestation, and notes
controls whose writes 401'd. With no route ErrorBoundary the 401 hit the
root boundary and replaced the live drill with an error page mid-drill.
The loader already knew the caller was a guest; it just never said so."
```

---

### Task 3: Tell the guest why the controls are inert

**Files:**
- Modify: `app/routes/drills.live.tsx` (render a notice above `ChecklistTable`, ~`:1170`)
- Modify: `public/locales/en/roster.json` (`drillsLive.readOnlyNotice`)
- Modify: `public/locales/es/roster.json` (`drillsLive.readOnlyNotice`)

**Interfaces:**
- Consumes: `canEdit` from Task 2.

Disabled controls with no explanation read as broken. This adds one line of copy. It renders only for guests — staff on a *paused* drill already get `drillsLive.bannerPaused`.

- [ ] **Step 1: Add the English string**

In `public/locales/en/roster.json`, inside the `drillsLive` object, add (keys are sorted alphabetically in this file — place it between `presence` and `removeItem`):

```json
    "readOnlyNotice": "You're watching as a guest. Attestations, notes, and follow-ups are read-only.",
```

- [ ] **Step 2: Add the Spanish string**

In `public/locales/es/roster.json`, inside the `drillsLive` object, at the matching position:

```json
    "readOnlyNotice": "Estás viendo como invitado. Las certificaciones, las notas y los seguimientos son de solo lectura.",
```

- [ ] **Step 3: Render it**

In `app/routes/drills.live.tsx`, find the attest-summary paragraph that ends with `})}` followed by `</p>` (just above `<ChecklistTable`, ~`:1163-1172`). Immediately **after** that closing `</p>` and **before** `<ChecklistTable`, insert:

```tsx
          {!canEdit && (
            <p
              className="-mt-1 inline-flex items-center gap-2 self-start rounded-md border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs font-medium text-amber-100/90"
              role="status"
            >
              {t("drillsLive.readOnlyNotice")}
            </p>
          )}
```

- [ ] **Step 4: Run the i18n guard**

Run: `npx tsx --test app/lib/i18n-keys.test.ts`
Expected: PASS. A failure here means the key is missing from `en` or `es`, or the two files disagree — fix the JSON, do not edit the test.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/routes/drills.live.tsx public/locales/en/roster.json public/locales/es/roster.json
git commit -m "feat(drills): explain read-only mode to magic-code guests"
```

---

### Task 4: End-to-end verification

**Files:**
- Modify: `e2e/drills.spec.ts`

**Interfaces:**
- Consumes: the rendered read-only UI from Tasks 2-3.

This test needs two things the current `e2e/drills.spec.ts` has never needed: a live drill with audience `EVERYONE`, and a browser holding a **real** viewer-pin session. The session cookie (`pickuproster_viewer_session`, see `app/domain/auth/viewer-access.server.ts:10`) carries a token validated against a DB row, so it cannot be fabricated — the test must drive the actual claim flow.

Note that `e2e/drills.spec.ts` currently imports from `@playwright/test` directly, while `e2e/flows/admin-roster.spec.ts` uses `../fixtures/seeded-tenant` for `{ page, tenant }` with `tenant.adminCookie` / `tenant.tenantUrl(path)`. This test needs a tenant, so use the seeded-tenant fixture.

- [ ] **Step 1: Learn the two flows you need to drive**

Run these and read the results before writing a line of the test:

```bash
rg -n "audience|EVERYONE|start-live|startConfirm" app/routes/admin/drills.tsx
rg -n "export async function (loader|action)|intent|Form|button" app/routes/viewer-access.tsx
rg -n "adminCookie|tenantUrl|homeroomName" e2e/fixtures/seeded-tenant.ts
```

From these, write down: (a) the exact control that starts a drill with audience Everyone, (b) the exact steps that turn a fresh browser context into one holding a viewer session.

- [ ] **Step 2: Add the guest read-only case**

Create the test in `e2e/drills.spec.ts`, filling the two `arrange` sections from what Step 1 revealed. The assertions below are final — do not weaken them:

```ts
test.describe("@flow drills — guest read-only", () => {
  test("magic-code guest sees a read-only live drill, not an error page", async ({
    page,
    browser,
    tenant,
  }) => {
    // Arrange 1: admin starts an EVERYONE drill. (Controls per Step 1a.)
    await page.context().addCookies([tenant.adminCookie]);
    await page.goto(tenant.tenantUrl("/admin/drills"));
    // ...start a drill with audience Everyone...

    // Arrange 2: a SEPARATE context with no admin cookie claims a viewer
    // link, so the guest genuinely holds only a viewer-pin session.
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    // ...drive the viewer-access claim flow per Step 1b...

    await guest.goto(tenant.tenantUrl("/drills/live"));

    // The read-only notice renders...
    await expect(guest.getByText(/watching as a guest/i)).toBeVisible();

    // ...attest buttons are inert...
    await expect(
      guest.getByRole("button", { name: /attest all-clear/i }).first(),
    ).toBeDisabled();

    // ...the notes field is inert...
    await expect(guest.getByRole("textbox").first()).toBeDisabled();

    // ...and the page is still the drill, not the root error boundary.
    await expect(guest.getByText(/not logged in/i)).toHaveCount(0);

    await guestContext.close();
  });
});
```

If driving the viewer-access claim flow proves to be more than ~30 minutes of work, stop and say so rather than weakening the test — Task 1's unit tests plus the manual smoke check below already cover the policy, and a half-real e2e test is worse than none.

- [ ] **Step 3: Point Playwright's browser cache off the rootfs, then install**

```bash
export PLAYWRIGHT_BROWSERS_PATH="$(ls -d /sessions/*/mnt/outputs 2>/dev/null | head -1)/.ms-playwright"
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
npx playwright install chromium
```

Skip the export/install entirely if not on a Cowork sandbox. Never run a bare `npx playwright install` — it pulls all three engines and can fill the disk.

- [ ] **Step 4: Run the drill e2e spec**

Run: `npx playwright test e2e/drills.spec.ts`
Expected: PASS, including the new case.

- [ ] **Step 5: Clean up test cruft**

```bash
npm run clean:e2e && npm run clean:tmp
```

- [ ] **Step 6: Commit**

```bash
git add e2e/drills.spec.ts
git commit -m "test(e2e): guest sees a read-only live drill, not an error page"
```

---

## Manual smoke check (optional, after Task 3)

Per `project_local_board_verification`, local tenant routes need `wrangler dev` plus a seeded-tenant fixture against a migrated local D1 — `npm run dev` alone will not resolve a tenant.

1. `npm run dev:worker`
2. Sign in as an admin, start a drill with audience **Everyone**.
3. Open `/viewer-access`, claim a magic link, and land on `/drills/live` in a private window.
4. Confirm: the amber read-only notice renders; checkboxes and "Attest all-clear" are disabled; the notes textarea is disabled; no "Add follow-up" button.
5. Confirm the page still shows the drill after clicking around — no "Not Logged In" takeover.
6. Sign in as a **teacher** (role `VIEWER`) in another window and confirm they *can* still attest. This is the regression that matters most.
