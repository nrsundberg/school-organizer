# Drill Audience Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins choose per drill (template default + per-run override) whether a live drill is visible to `STAFF_ONLY` or `EVERYONE`, redirect every in-audience caller (including viewer-pin guests) to `/drills/live`, and replace the per-save toast with an inline "Saving…/Saved" indicator.

**Architecture:** Two new Prisma columns (`DrillTemplate.defaultAudience`, `DrillRun.audience`) drive a pure audience-membership gate that replaces today's `userIsAdmin` exemption. The root loader computes membership from either `userContext.user` (STAFF) or `hasValidViewerAccess` (VIEWER_PIN); the gate maps `(membership, audience)` → redirect-or-not. Excluded viewer-pin guests get a 404 on `/drills/live`. The save toast is dropped; the page derives a "Saving…/Saved" indicator from `fetcher.state` and a local `lastSavedAt` timestamp.

**Tech Stack:** React Router 7, Cloudflare Workers, Prisma + D1, better-auth (for staff sessions) + custom viewer-pin cookie, `node:test`, Playwright (e2e), `react-i18next`, HeroUI (`Popover`).

**Spec:** [docs/superpowers/specs/2026-04-27-drill-audience-visibility-design.md](../specs/2026-04-27-drill-audience-visibility-design.md)

---

## File Map

**Created:**
- `migrations/0029_drill_audience.sql` — adds two columns with `'EVERYONE'` defaults.

**Modified:**
- `prisma/schema.prisma` — `DrillTemplate.defaultAudience`, `DrillRun.audience`.
- `app/domain/drills/types.ts` — `DrillAudience` union, `parseDrillAudience`.
- `app/domain/drills/live-redirect.server.ts` — replace `userIsAdmin` branch with membership-based gate; new `AudienceMembership` type; `/admin/` added to `ALLOW_PREFIXES`.
- `app/domain/drills/live-redirect.server.test.ts` — rewrite around the membership matrix.
- `app/domain/drills/live.server.ts` — `startDrillRun` accepts `audience`; `getActiveDrillRun` returns it.
- `app/domain/drills/live.server.test.ts` — fake-prisma row gains `audience`; new tests assert `startDrillRun` writes the audience.
- `app/root.tsx` — compute `AudienceMembership` (user OR viewer-pin) and call the new gate.
- `app/routes/drills.live.tsx` — audience-gate the loader (404 for excluded viewer-pin), drop `Saved` toast, add inline indicator, audience badge in the banner.
- `app/routes/admin/drills.tsx` — start-live action accepts `audience` form field; per-row "Start live drill" → HeroUI Popover with audience picker.
- `app/routes/admin/drills.$templateId.tsx` — `defaultAudience` radio group; "Start live drill" → Popover that defaults to template's `defaultAudience`.
- `app/routes/admin/drills.history.$runId.tsx` — audience chip beside the status chip.
- `public/locales/{en,es}/roster.json` — drop `drillsLive.toasts.saved`; add `drillsLive.savedIndicator.{idle,saving,saved}` and `drillsLive.audience.{everyone,staffOnly}`.
- `public/locales/{en,es}/admin.json` — add `drills.list.startConfirm.*`, `drills.edit.startConfirm.*`, `drills.edit.defaultAudience.*`, `drillsHistory.replay.audience.*`.

**E2E (added if not present):**
- `e2e/drills-audience.spec.ts` — admin starts a STAFF_ONLY drill; viewer-pin guest stays on `/`; admin starts an EVERYONE drill; viewer-pin guest is redirected to `/drills/live`.

---

## Conventions

- Each task is **TDD where possible**: failing test → minimal code → passing test → commit.
- After every task: run `npm test` (Node `--test`); ensure no regressions.
- Commit messages follow the repo's existing style (`feat: …`, `fix: …`, `refactor: …`).
- Never amend; always create a new commit so each step is reviewable.
- The plan **does not invoke** `wrangler d1 migrations apply` against staging or prod — that's a deploy step, not a code step. Local-only `prisma generate` is fine.

---

## Task 1: Add migration SQL + Prisma schema columns

**Files:**
- Create: `migrations/0029_drill_audience.sql`
- Modify: `prisma/schema.prisma:221-243` (DrillTemplate), `prisma/schema.prisma:249-274` (DrillRun)

- [ ] **Step 1: Create the migration SQL**

Write `migrations/0029_drill_audience.sql`:

```sql
-- Audience for live drills. Two tiers:
--   STAFF_ONLY  → only staff (signed-in User rows) see the takeover; viewer-pin
--                 guests continue to see the normal board.
--   EVERYONE    → staff + viewer-pin guests see the takeover.
--
-- DrillTemplate.defaultAudience is the default pre-selected when an admin starts
-- a live drill from the template. DrillRun.audience is the frozen choice for
-- this run; admins cannot change it mid-run (would orphan or pull in viewers
-- mid-event). Both backfill to 'EVERYONE' so historical runs keep today's
-- behavior (no audience scoping existed before this migration).

ALTER TABLE "DrillTemplate"
  ADD COLUMN "defaultAudience" TEXT NOT NULL DEFAULT 'EVERYONE';

ALTER TABLE "DrillRun"
  ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'EVERYONE';
```

- [ ] **Step 2: Update Prisma schema**

In `prisma/schema.prisma`, inside `model DrillTemplate { ... }`, add after `definition Json`:

```prisma
  /// Default audience for new live runs from this template:
  /// "STAFF_ONLY" | "EVERYONE". Pre-selected on the start-live confirm.
  defaultAudience String     @default("EVERYONE")
```

In `model DrillRun { ... }`, add after `status String @default("ENDED")`:

```prisma
  /// Audience this run was started with: "STAFF_ONLY" | "EVERYONE".
  /// Frozen at start time. See DrillTemplate.defaultAudience.
  audience    String        @default("EVERYONE")
```

- [ ] **Step 3: Regenerate Prisma client**

Run: `npm run prisma:generate` (or whatever the repo uses; likely `npx prisma generate`).
Expected: completes with no errors; `app/db/index.ts` re-exports gain the new columns in `DrillTemplate` and `DrillRun` types.

If `npm run prisma:generate` doesn't exist, run:

```bash
npx prisma generate
```

- [ ] **Step 4: Apply migration locally**

Run: `npm run d1:migrate`
Expected: migration `0029_drill_audience.sql` applied to local D1.

- [ ] **Step 5: Sanity check the new columns are reachable**

Run a quick read in the Node REPL or via a small script (no commit needed) to confirm the schema is in sync. If your repo has a `prisma:check`, run it. Otherwise skip this step — Task 4's tests will fail loudly if the columns aren't there.

- [ ] **Step 6: Commit**

```bash
git add migrations/0029_drill_audience.sql prisma/schema.prisma
git commit -m "feat(drills): add audience columns to DrillTemplate and DrillRun"
```

---

## Task 2: Add `DrillAudience` union and parser

**Files:**
- Modify: `app/domain/drills/types.ts`
- Test: `app/domain/drills/types.test.ts` (existing — add a new `describe` block)

- [ ] **Step 1: Add the failing test**

Open `app/domain/drills/types.test.ts` and append a new `describe`:

```ts
import {
  isDrillAudience,
  parseDrillAudience,
  DRILL_AUDIENCE_LABELS,
  type DrillAudience,
} from "./types";

describe("DrillAudience", () => {
  it("isDrillAudience accepts both tiers", () => {
    assert.equal(isDrillAudience("STAFF_ONLY"), true);
    assert.equal(isDrillAudience("EVERYONE"), true);
  });

  it("isDrillAudience rejects garbage", () => {
    assert.equal(isDrillAudience("everyone"), false);
    assert.equal(isDrillAudience(""), false);
    assert.equal(isDrillAudience(undefined), false);
    assert.equal(isDrillAudience({} as unknown), false);
  });

  it("parseDrillAudience round-trips valid input", () => {
    assert.equal(parseDrillAudience("STAFF_ONLY"), "STAFF_ONLY");
    assert.equal(parseDrillAudience("EVERYONE"), "EVERYONE");
  });

  it("parseDrillAudience defaults invalid input to EVERYONE", () => {
    assert.equal(parseDrillAudience(null), "EVERYONE");
    assert.equal(parseDrillAudience("staff_only"), "EVERYONE");
    assert.equal(parseDrillAudience(42), "EVERYONE");
  });

  it("DRILL_AUDIENCE_LABELS has both tiers", () => {
    const labels: Record<DrillAudience, string> = DRILL_AUDIENCE_LABELS;
    assert.equal(typeof labels.STAFF_ONLY, "string");
    assert.equal(typeof labels.EVERYONE, "string");
  });
});
```

- [ ] **Step 2: Run the test, expect it to fail**

Run: `npx tsx --test app/domain/drills/types.test.ts` (or `npm test -- --test-name-pattern=DrillAudience` if the project uses a wrapper).
Expected: FAIL with `is not exported from './types'` or similar.

- [ ] **Step 3: Add the union, label map, and parser to `types.ts`**

In `app/domain/drills/types.ts`, after the existing `DrillRunStatus` block (line ~104), add:

```ts
/**
 * Live-drill audience scoping. STAFF_ONLY hides the takeover from viewer-pin
 * guests (they continue to see the normal board); EVERYONE shows it to staff
 * and viewer-pin guests. Anonymous callers (no user, no viewer pin) are never
 * redirected regardless of audience.
 */
export type DrillAudience = "STAFF_ONLY" | "EVERYONE";

export const DRILL_AUDIENCES: readonly DrillAudience[] = [
  "STAFF_ONLY",
  "EVERYONE",
] as const;

export const DRILL_AUDIENCE_LABELS: Record<DrillAudience, string> = {
  STAFF_ONLY: "Staff only",
  EVERYONE: "Everyone",
};

export function isDrillAudience(v: unknown): v is DrillAudience {
  return v === "STAFF_ONLY" || v === "EVERYONE";
}

/**
 * Coerce arbitrary input (DB column read, form value) to a `DrillAudience`,
 * defaulting to "EVERYONE" so older rows / corrupt input behave like
 * pre-feature visibility (everyone in audience).
 */
export function parseDrillAudience(v: unknown): DrillAudience {
  return isDrillAudience(v) ? v : "EVERYONE";
}
```

- [ ] **Step 4: Run the test, expect it to pass**

Run: `npx tsx --test app/domain/drills/types.test.ts`
Expected: all DrillAudience tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/drills/types.ts app/domain/drills/types.test.ts
git commit -m "feat(drills): add DrillAudience union, label map, and parser"
```

---

## Task 3: Refactor live-redirect to membership-based gate

**Files:**
- Modify: `app/domain/drills/live-redirect.server.ts`
- Test: `app/domain/drills/live-redirect.server.test.ts` (full rewrite)

- [ ] **Step 1: Replace the test file with the new matrix**

Overwrite `app/domain/drills/live-redirect.server.test.ts`:

```ts
// Unit tests for the live-drill audience-membership gate in
// `app/domain/drills/live-redirect.server.ts`.
//
// The redirect is a pure function of:
//   - membership: caller's category (STAFF | VIEWER_PIN | NONE)
//   - audience:   the active run's audience (STAFF_ONLY | EVERYONE | null)
//   - pathname:   request URL pathname (allow-list short-circuits)
//
// Decision matrix:
//   audience | STAFF | VIEWER_PIN | NONE
//   ---------+-------+------------+------
//   null     |   ✗   |     ✗      |  ✗    (no active drill — never redirect)
//   STAFF_ONLY|  ✓   |     ✗      |  ✗
//   EVERYONE |   ✓   |     ✓      |  ✗
//
// Allow-listed paths (/drills/live, /logout, /set-password, /admin/, /api/,
// /assets/, /build/) ALWAYS short-circuit to null even if the caller is in
// the audience.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  liveDrillRedirectTarget,
  type LiveRedirectInput,
} from "./live-redirect.server";

function call(overrides: Partial<LiveRedirectInput>): string | null {
  return liveDrillRedirectTarget({
    membership: "STAFF",
    audience: "EVERYONE",
    pathname: "/",
    ...overrides,
  });
}

describe("liveDrillRedirectTarget — no active drill", () => {
  it("audience=null + any membership → null", () => {
    assert.equal(call({ membership: "STAFF", audience: null }), null);
    assert.equal(call({ membership: "VIEWER_PIN", audience: null }), null);
    assert.equal(call({ membership: "NONE", audience: null }), null);
  });
});

describe("liveDrillRedirectTarget — STAFF_ONLY drill", () => {
  it("STAFF in audience → /drills/live", () => {
    assert.equal(
      call({ membership: "STAFF", audience: "STAFF_ONLY", pathname: "/" }),
      "/drills/live",
    );
  });

  it("VIEWER_PIN excluded → null", () => {
    assert.equal(
      call({ membership: "VIEWER_PIN", audience: "STAFF_ONLY", pathname: "/" }),
      null,
    );
  });

  it("NONE excluded → null", () => {
    assert.equal(
      call({ membership: "NONE", audience: "STAFF_ONLY", pathname: "/" }),
      null,
    );
  });
});

describe("liveDrillRedirectTarget — EVERYONE drill", () => {
  it("STAFF in audience → /drills/live", () => {
    assert.equal(
      call({ membership: "STAFF", audience: "EVERYONE", pathname: "/" }),
      "/drills/live",
    );
  });

  it("VIEWER_PIN in audience → /drills/live", () => {
    assert.equal(
      call({ membership: "VIEWER_PIN", audience: "EVERYONE", pathname: "/" }),
      "/drills/live",
    );
  });

  it("NONE never redirected (anonymous handled by other auth flows)", () => {
    assert.equal(
      call({ membership: "NONE", audience: "EVERYONE", pathname: "/" }),
      null,
    );
  });
});

describe("liveDrillRedirectTarget — allow-list", () => {
  it("STAFF + EVERYONE drill on /drills/live → null (already there)", () => {
    assert.equal(call({ pathname: "/drills/live" }), null);
  });

  it("STAFF + EVERYONE drill on /logout → null", () => {
    assert.equal(call({ pathname: "/logout" }), null);
  });

  it("STAFF + EVERYONE drill on /set-password → null", () => {
    assert.equal(call({ pathname: "/set-password" }), null);
  });

  it("STAFF + EVERYONE drill on /api/* → null", () => {
    assert.equal(call({ pathname: "/api/foo" }), null);
    assert.equal(call({ pathname: "/api/auth/session" }), null);
  });

  it("STAFF + EVERYONE drill on /assets/* or /build/* → null", () => {
    assert.equal(call({ pathname: "/assets/logo.svg" }), null);
    assert.equal(call({ pathname: "/build/index.js" }), null);
  });

  it("STAFF + EVERYONE drill on /admin/* → null (admins keep admin access)", () => {
    assert.equal(call({ pathname: "/admin/drills" }), null);
    assert.equal(call({ pathname: "/admin/billing" }), null);
  });

  it("VIEWER_PIN + EVERYONE drill on /admin/* → null (admin paths never redirect)", () => {
    // Even though admin paths 401 viewer-pin guests, the redirect gate doesn't
    // care — it's the route's job to enforce admin auth. We just don't try to
    // redirect them here.
    assert.equal(
      call({ membership: "VIEWER_PIN", pathname: "/admin/drills" }),
      null,
    );
  });
});

describe("liveDrillRedirectTarget — empty path", () => {
  it("empty pathname is treated as '/'", () => {
    assert.equal(
      call({ membership: "STAFF", audience: "EVERYONE", pathname: "" }),
      "/drills/live",
    );
  });
});
```

- [ ] **Step 2: Run the test, expect it to fail**

Run: `npx tsx --test app/domain/drills/live-redirect.server.test.ts`
Expected: FAIL — current `LiveRedirectInput` has `user`/`isAdmin`/`hasActiveDrill`, not `membership`/`audience`.

- [ ] **Step 3: Rewrite `live-redirect.server.ts`**

Replace the entire file contents with:

```ts
import type { DrillAudience } from "./types";

/**
 * Caller's audience-membership category.
 *
 * - STAFF       — any signed-in User in this org (ADMIN, CONTROLLER, TEACHER,
 *                 or User.role === "VIEWER" — the latter is a real low-perm
 *                 account, NOT the magic-code viewer-pin concept).
 * - VIEWER_PIN  — anonymous (no `User`) but holds a valid viewer-pin session
 *                 cookie via `hasValidViewerAccess`.
 * - NONE        — fully anonymous; never redirected.
 */
export type AudienceMembership = "STAFF" | "VIEWER_PIN" | "NONE";

/**
 * Inputs to the live-drill audience-membership gate.
 *
 * Pure function of (membership, audience, pathname) so it's trivial to
 * unit-test without mocking Prisma / request objects.
 */
export interface LiveRedirectInput {
  /** Caller's audience-membership category. */
  membership: AudienceMembership;
  /**
   * Audience of the currently-LIVE-or-PAUSED run, or `null` if none.
   * Callers should only compute this when cheap / necessary (i.e. skip on
   * marketing hosts and when membership is "NONE").
   */
  audience: DrillAudience | null;
  /** Lowercased `URL.pathname` of the incoming request. */
  pathname: string;
}

/**
 * Paths that must remain reachable during a live drill, even for in-audience
 * callers. Uses prefix matching for nested groups (api/*, admin/*, assets/*).
 *
 * - /drills/live: the takeover itself must not redirect to itself.
 * - /logout, /set-password: auth flows must work so users can fix session state.
 * - /api/*: invoked by fetch / better-auth — never swap for a 302 HTML response.
 * - /admin/*: admins must reach admin pages mid-drill (billing, roster).
 *   They are still redirected on first arrival to `/`, which is the
 *   canonical takeover trigger.
 * - /assets/*, /build/*: static assets.
 */
const ALLOW_PATHS: readonly string[] = ["/drills/live", "/logout", "/set-password"];
const ALLOW_PREFIXES: readonly string[] = [
  "/api/",
  "/admin/",
  "/assets/",
  "/build/",
];

/**
 * Returns true when the caller's `membership` is in the run's `audience`.
 *
 *   audience    | STAFF | VIEWER_PIN | NONE
 *   ------------+-------+------------+------
 *   STAFF_ONLY  |  ✓    |    ✗       |  ✗
 *   EVERYONE    |  ✓    |    ✓       |  ✗
 */
export function isInAudience(
  membership: AudienceMembership,
  audience: DrillAudience,
): boolean {
  if (membership === "NONE") return false;
  if (audience === "EVERYONE") return true;
  // audience === "STAFF_ONLY"
  return membership === "STAFF";
}

/**
 * Pure function: returns the path to redirect the caller to, or `null` if no
 * redirect should happen. Designed to be called from the root loader.
 *
 * Decision table:
 *   - audience is null (no active drill):       null
 *   - membership not in audience:               null
 *   - path is in the allow-list:                null
 *   - otherwise:                                "/drills/live"
 */
export function liveDrillRedirectTarget(
  input: LiveRedirectInput,
): string | null {
  if (input.audience === null) return null;
  if (!isInAudience(input.membership, input.audience)) return null;

  const path = input.pathname || "/";
  if (ALLOW_PATHS.includes(path)) return null;
  for (const prefix of ALLOW_PREFIXES) {
    if (path.startsWith(prefix)) return null;
  }

  return "/drills/live";
}
```

- [ ] **Step 4: Run the test, expect it to pass**

Run: `npx tsx --test app/domain/drills/live-redirect.server.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Verify no other callers of `userIsAdmin` from this module**

Run: `grep -rn "from \"~/domain/drills/live-redirect" /Users/noah/personal/dev/school-organizer/.claude/worktrees/sleepy-chaum-987e0f/app`
Expected: only `app/root.tsx` and `app/routes/drills.live.tsx` import from this module. We will update both in Task 5 and Task 6 respectively. The `userIsAdmin` export was used by:
- `app/root.tsx` line 55 — replaced in Task 5
- `app/routes/drills.live.tsx` line 25 — replaced in Task 6

We're removing `userIsAdmin` from the module entirely. Both call sites get rewritten in their respective tasks; the build will be momentarily broken between Task 3 and Task 5, which is expected and acceptable as long as we land them in order. To keep the tree compiling between commits:

Re-export a temporary shim from `live-redirect.server.ts` so the build doesn't break before Tasks 5 and 6 land:

```ts
// Temporary re-export — remove after Tasks 5 and 6 stop importing it.
import type { User } from "~/db";
export function userIsAdmin(
  user: Pick<User, "role"> | null | undefined,
): boolean {
  if (!user) return false;
  return user.role === "ADMIN" || user.role === "CONTROLLER";
}
```

Add the shim to the bottom of the new `live-redirect.server.ts`. Tasks 5 and 6 will delete it.

- [ ] **Step 6: Run `npm test` to confirm nothing else regressed**

Run: `npm test`
Expected: all suites PASS. (The shim keeps `app/root.tsx` and `app/routes/drills.live.tsx` compiling even though we haven't touched them yet.)

- [ ] **Step 7: Commit**

```bash
git add app/domain/drills/live-redirect.server.ts app/domain/drills/live-redirect.server.test.ts
git commit -m "refactor(drills): replace admin-exemption with audience-membership gate"
```

---

## Task 4: `live.server` — startDrillRun accepts audience; getActiveDrillRun returns it

**Files:**
- Modify: `app/domain/drills/live.server.ts`
- Test: `app/domain/drills/live.server.test.ts`

- [ ] **Step 1: Extend `FakeDrillRunRow` and add new tests**

In `app/domain/drills/live.server.test.ts`, find the `FakeDrillRunRow` interface and add `audience: "STAFF_ONLY" | "EVERYONE"` near the other fields. In the create handler that builds the row, default `audience: args.data.audience ?? "EVERYONE"`. Then append:

```ts
describe("startDrillRun audience", () => {
  it("defaults audience to EVERYONE when caller omits it", async () => {
    const fakePrisma = makeFakePrisma();
    const run = await startDrillRun(
      fakePrisma as unknown as PrismaClient,
      "org-1",
      "tpl-1",
    );
    assert.equal(run.audience, "EVERYONE");
  });

  it("writes STAFF_ONLY when caller passes it", async () => {
    const fakePrisma = makeFakePrisma();
    const run = await startDrillRun(
      fakePrisma as unknown as PrismaClient,
      "org-1",
      "tpl-1",
      undefined,
      undefined,
      "STAFF_ONLY",
    );
    assert.equal(run.audience, "STAFF_ONLY");
  });

  it("getActiveDrillRun returns the audience field", async () => {
    const fakePrisma = makeFakePrisma();
    await startDrillRun(
      fakePrisma as unknown as PrismaClient,
      "org-1",
      "tpl-1",
      undefined,
      undefined,
      "STAFF_ONLY",
    );
    const active = await getActiveDrillRun(
      fakePrisma as unknown as PrismaClient,
      "org-1",
    );
    assert.equal(active?.audience, "STAFF_ONLY");
  });
});
```

(If `makeFakePrisma` is named differently in the existing file, use the actual factory. The test file has a hand-rolled fake — extend it; don't replace it.)

- [ ] **Step 2: Run the test, expect it to fail**

Run: `npx tsx --test app/domain/drills/live.server.test.ts`
Expected: FAIL with "expected EVERYONE, got undefined" or similar — `audience` not in the row.

- [ ] **Step 3: Update `startDrillRun` signature and write**

In `app/domain/drills/live.server.ts`, change `startDrillRun`:

```ts
import type { DrillAudience } from "./types";

export async function startDrillRun(
  prisma: PrismaClient,
  orgId: string,
  templateId: string,
  initialState: RunState = emptyRunState(),
  actor: ActorIds = { actorUserId: null, onBehalfOfUserId: null },
  audience: DrillAudience = "EVERYONE",
) {
  const now = new Date();
  try {
    const run = await prisma.drillRun.create({
      data: {
        orgId,
        templateId,
        status: "LIVE",
        activatedAt: now,
        state: initialState as object,
        audience,
        lastActorUserId: actor.actorUserId,
        lastActorOnBehalfOfUserId: actor.onBehalfOfUserId,
      },
    });
    await prisma.drillRunEvent.create({
      data: eventCreateData(
        run.id,
        { kind: "started", initialState },
        actor,
        now,
      ),
    });
    return run;
  } catch (err) {
    if (isActiveDrillUniqueViolation(err)) {
      throw activeDrillConflictResponse();
    }
    throw err;
  }
}
```

`getActiveDrillRun` does NOT need code changes — Prisma's default `findFirst` returns all scalar columns, so `audience` is included automatically once the schema regenerated in Task 1.

- [ ] **Step 4: Run the test, expect it to pass**

Run: `npx tsx --test app/domain/drills/live.server.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/drills/live.server.ts app/domain/drills/live.server.test.ts
git commit -m "feat(drills): startDrillRun accepts audience; getActiveDrillRun returns it"
```

---

## Task 5: `root.tsx` — compute membership from user OR viewer-pin

**Files:**
- Modify: `app/root.tsx:32-57` (imports), `app/root.tsx:139-165` (live-drill block)

- [ ] **Step 1: Update imports at the top of `app/root.tsx`**

Replace the existing import (around line 53-56):

```ts
import {
  liveDrillRedirectTarget,
  userIsAdmin
} from "~/domain/drills/live-redirect.server";
```

with:

```ts
import {
  liveDrillRedirectTarget,
  type AudienceMembership
} from "~/domain/drills/live-redirect.server";
import { parseDrillAudience } from "~/domain/drills/types";
import { hasValidViewerAccess } from "~/domain/auth/viewer-access.server";
```

- [ ] **Step 2: Replace the live-drill block (currently lines 139-165)**

Replace:

```ts
  // Live drill takeover: when a drill is LIVE or PAUSED in this org, non-admin
  // signed-in users are force-redirected to /drills/live. Admins stay on
  // whatever route they requested so they can manage things. The allow-list
  // (logout, /api/*, static assets) is encapsulated in liveDrillRedirectTarget
  // so it's unit-testable and consistent across callers.
  if (!marketing && user && org && !userIsAdmin(user)) {
    try {
      const prisma = getTenantPrisma(context);
      const activeRun = await getActiveDrillRun(prisma, org.id);
      if (activeRun) {
        const url = new URL(request.url);
        const target = liveDrillRedirectTarget({
          user,
          pathname: url.pathname,
          hasActiveDrill: true,
          isAdmin: false
        });
        if (target) {
          throw redirect(target);
        }
      }
    } catch (e) {
      // Let redirects propagate; swallow DB lookup errors so a transient D1
      // hiccup doesn't take down the whole app shell.
      if (e instanceof Response) throw e;
    }
  }
```

with:

```ts
  // Live drill takeover: when a drill is LIVE or PAUSED in this org, every
  // caller in the audience (STAFF, plus VIEWER_PIN if audience === EVERYONE)
  // is redirected to /drills/live. Anonymous callers and out-of-audience
  // viewer-pin guests stay on whatever route they requested. The allow-list
  // (logout, /api/*, /admin/*, static assets) is encapsulated in
  // liveDrillRedirectTarget so it's unit-testable and consistent.
  if (!marketing && org) {
    let membership: AudienceMembership = "NONE";
    if (user) {
      membership = "STAFF";
    } else if (await hasValidViewerAccess({ request, context })) {
      membership = "VIEWER_PIN";
    }

    if (membership !== "NONE") {
      try {
        const prisma = getTenantPrisma(context);
        const activeRun = await getActiveDrillRun(prisma, org.id);
        if (activeRun) {
          const url = new URL(request.url);
          const target = liveDrillRedirectTarget({
            membership,
            audience: parseDrillAudience(activeRun.audience),
            pathname: url.pathname,
          });
          if (target) {
            throw redirect(target);
          }
        }
      } catch (e) {
        // Let redirects propagate; swallow DB lookup errors so a transient D1
        // hiccup doesn't take down the whole app shell.
        if (e instanceof Response) throw e;
      }
    }
  }
```

- [ ] **Step 3: Manually verify with `npm test`**

Run: `npm test`
Expected: all PASS (no test specifically covers root.tsx, but TypeScript compilation runs as part of the test pipeline; if the import shape is wrong it fails here).

- [ ] **Step 4: Manual smoke check (no commit yet)**

Boot the worker dev server: `npm run dev:worker`
- Sign in as an admin user in one tab; start a STAFF_ONLY live drill from `/admin/drills`.
- In another tab (incognito), enter a viewer pin at `/viewer-access`.
- Confirm the viewer-pin tab on `/` shows the **normal car-line board** (no banner, no redirect).
- Open the same admin tab to `/`; confirm it redirects to `/drills/live`.
- End the drill, restart it as `EVERYONE`, refresh the viewer tab — confirm it now redirects to `/drills/live`.

If anything looks off, do NOT commit; fix the loader and re-test. Drop a one-line note in this task's checkbox if anything surprised you.

- [ ] **Step 5: Commit**

```bash
git add app/root.tsx
git commit -m "feat(drills): compute audience membership in root loader (user or viewer-pin)"
```

---

## Task 6: `drills.live` route — audience gate, drop save toast, inline indicator, banner badge

**Files:**
- Modify: `app/routes/drills.live.tsx`
- Modify: `public/locales/en/roster.json`, `public/locales/es/roster.json`
- Modify: `app/domain/drills/live-redirect.server.ts` (delete the temporary `userIsAdmin` shim)

- [ ] **Step 1: Add new i18n keys (English)**

In `public/locales/en/roster.json`, inside `drillsLive`:
- DELETE the `toasts.saved` key (keep `toasts.paused`, `toasts.resumed`).
- ADD:

```json
"savedIndicator": {
  "saving": "Saving…",
  "saved": "Saved · just now"
},
"audience": {
  "everyone": "Everyone",
  "staffOnly": "Staff only"
},
"audienceBadge": "Audience: {{label}}"
```

- [ ] **Step 2: Add Spanish equivalents**

In `public/locales/es/roster.json`, mirror exactly:
- DELETE `drillsLive.toasts.saved`
- ADD:

```json
"savedIndicator": {
  "saving": "Guardando…",
  "saved": "Guardado · ahora"
},
"audience": {
  "everyone": "Todos",
  "staffOnly": "Solo personal"
},
"audienceBadge": "Audiencia: {{label}}"
```

- [ ] **Step 3: Rewrite the loader to gate by audience**

Open `app/routes/drills.live.tsx`. Replace the import block (lines 11-33) — remove `userIsAdmin` import; add `parseDrillAudience` and `hasValidViewerAccess`:

```ts
import {
  getActorIdsFromContext,
  getOptionalUserFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  cycleToggle,
  parseDrillAudience,
  parseRunState,
  parseTemplateDefinition,
  toggleKey,
  type DrillAudience,
  type RunState,
} from "~/domain/drills/types";
import { ChecklistTable } from "~/domain/drills/ChecklistTable";
import {
  endDrillRun,
  getActiveDrillRun,
  pauseDrillRun,
  resumeDrillRun,
  updateLiveRunState,
} from "~/domain/drills/live.server";
import { hasValidViewerAccess } from "~/domain/auth/viewer-access.server";
import type { Prisma } from "~/db";
```

Replace the loader (currently lines 50-108) with:

```ts
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  const org = getOrgFromContext(context);
  const prisma = getTenantPrisma(context);
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "roster");

  // Compute membership: STAFF if signed-in user; else VIEWER_PIN if a valid
  // viewer cookie is present; else not allowed at all.
  let membership: "STAFF" | "VIEWER_PIN" | null = null;
  if (user) {
    membership = "STAFF";
  } else if (await hasValidViewerAccess({ request, context })) {
    membership = "VIEWER_PIN";
  }
  if (membership === null) {
    throw new Response("Not authenticated", { status: 401 });
  }

  let run;
  try {
    run = await getActiveDrillRun(prisma, org.id);
  } catch (err) {
    console.error(
      `[drills.live] loader getActiveDrillRun threw (org=${org.id})`,
      err,
    );
    throw err;
  }
  if (!run) {
    throw redirect("/");
  }

  const audience: DrillAudience = parseDrillAudience(run.audience);

  // Audience gate: viewer-pin guests can only see EVERYONE drills. 404 (not
  // 401) because logging in won't change the answer for them.
  if (membership === "VIEWER_PIN" && audience === "STAFF_ONLY") {
    throw new Response("Not found", { status: 404 });
  }

  // Admin = signed-in user with ADMIN/CONTROLLER role. Used purely for showing
  // the admin sidebar (pause/resume/end). Inlined here to avoid resurrecting
  // the deleted `userIsAdmin` helper just for one call site.
  const isAdmin =
    !!user && (user.role === "ADMIN" || user.role === "CONTROLLER");

  const paused = run.status === "PAUSED";
  const metaTitle = paused
    ? t("drillsLive.metaPaused", { name: run.template.name })
    : t("drillsLive.metaLive", { name: run.template.name });

  return {
    run: {
      id: run.id,
      status: run.status as "LIVE" | "PAUSED",
      activatedAtIso: run.activatedAt?.toISOString() ?? null,
      pausedAtIso: run.pausedAt?.toISOString() ?? null,
      state: run.state,
      updatedAtIso: run.updatedAt.toISOString(),
      audience,
    },
    template: {
      id: run.template.id,
      name: run.template.name,
      drillType: run.template.drillType,
      authority: run.template.authority,
      instructions: run.template.instructions,
      definition: run.template.definition,
    },
    isAdmin,
    paused,
    userName: user?.name || user?.email || "viewer",
    metaTitle,
  };
}
```

- [ ] **Step 4: Update the action — drop the "Saved" toast**

In the same file, replace the `update-state` branch in the action (around line 160-171):

```ts
    if (intent === "update-state") {
      const raw = String(formData.get("state") ?? "");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return dataWithError(null, t("drillsLive.errors.invalidStateJson"));
      }
      const next = parseRunState(parsed as Prisma.JsonValue);
      await updateLiveRunState(prisma, org.id, runId, next, actor);
      // No toast — the page renders an inline "Saving…/Saved" indicator
      // instead. Returning a non-null body so fetcher.data signals
      // success to the client.
      return { ok: true };
    }
```

The other action branches (`pause`, `resume`, `end`) keep their `dataWithSuccess` calls.

- [ ] **Step 5: Add inline indicator + audience badge to the component**

In the component (default export), update the imports near the top:

```tsx
import { Form, Link, redirect, useFetcher } from "react-router";
```

(Remove `useRevalidator` — RR re-runs loaders after every action automatically per [feedback_no_manual_revalidators.md](../../../.claude/projects/-Users-noah-personal-dev-school-organizer/memory/feedback_no_manual_revalidators.md).)

Inside the component, find the existing `useEffect` block that calls `revalidator.revalidate()` (around lines 230-234) and **delete it entirely**.

Add new state right after the existing `useState` calls:

```tsx
const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

// When a save succeeds (fetcher returns idle with non-error data), stamp
// "lastSavedAt" so the inline indicator shows "Saved · just now" briefly.
useEffect(() => {
  if (fetcher.state === "idle" && fetcher.data && !("error" in fetcher.data)) {
    setLastSavedAt(Date.now());
  }
}, [fetcher.state, fetcher.data]);

// Auto-clear the saved indicator after 1500ms.
useEffect(() => {
  if (lastSavedAt === null) return;
  const id = setTimeout(() => setLastSavedAt(null), 1500);
  return () => clearTimeout(id);
}, [lastSavedAt]);

const saveStatus: "idle" | "saving" | "saved" =
  fetcher.state !== "idle"
    ? "saving"
    : lastSavedAt !== null
      ? "saved"
      : "idle";
```

In the JSX, find the banner block (around line 344) and add the audience badge after the elapsed-time `div`:

```tsx
<span className="ml-2 inline-flex items-center rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
  {t("drillsLive.audienceBadge", {
    label:
      run.audience === "STAFF_ONLY"
        ? t("drillsLive.audience.staffOnly")
        : t("drillsLive.audience.everyone"),
  })}
</span>
```

In the JSX, find the checklist heading area (the `<main>` block, around the `<ChecklistTable>` element) and add an indicator above the table:

```tsx
<div className="flex items-center justify-end h-5 -mb-2 text-xs">
  {saveStatus === "saving" && (
    <span className="text-white/50 inline-flex items-center gap-1">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-white/50 animate-pulse"
      />
      {t("drillsLive.savedIndicator.saving")}
    </span>
  )}
  {saveStatus === "saved" && (
    <span className="text-emerald-300/80">
      {t("drillsLive.savedIndicator.saved")}
    </span>
  )}
</div>
```

- [ ] **Step 6: Delete the temporary `userIsAdmin` shim from `live-redirect.server.ts`**

Open `app/domain/drills/live-redirect.server.ts` and delete the temporary `userIsAdmin` re-export added in Task 3 Step 5. Also delete the `import type { User } from "~/db";` if it's now unused.

- [ ] **Step 7: Run all tests + typecheck**

Run: `npm test`
Expected: all PASS.

Run: `npx react-router typegen` (memory note: needed when route shapes change).
Run: `npx tsc --noEmit` (or whatever the repo uses for typecheck).
Expected: no TS errors.

- [ ] **Step 8: Smoke test the indicator**

Boot dev server, start a live drill, click some toggles in fast succession.
Expected: inline "Saving…" appears during fetcher in-flight; "Saved · just now" appears after success and disappears after ~1.5s. No toasts on toggles. Pause / Resume / End still toast.

- [ ] **Step 9: Commit**

```bash
git add app/routes/drills.live.tsx app/domain/drills/live-redirect.server.ts public/locales/en/roster.json public/locales/es/roster.json
git commit -m "feat(drills): audience-gate live page, inline save indicator, audience badge"
```

---

## Task 7: `admin/drills` — start-live confirm popover with audience picker

**Files:**
- Modify: `app/routes/admin/drills.tsx`
- Modify: `public/locales/en/admin.json`, `public/locales/es/admin.json`

- [ ] **Step 1: Add new i18n keys (English)**

In `public/locales/en/admin.json`, inside `drills.list`, add:

```json
"startConfirm": {
  "heading": "Start live drill",
  "subhead": "Choose the audience for {{name}}.",
  "audienceLabel": "Audience",
  "audienceEveryone": "Everyone — staff and viewer-pin guests see the takeover",
  "audienceStaffOnly": "Staff only — viewer-pin guests continue to see the normal board",
  "confirm": "Start live drill",
  "cancel": "Cancel"
}
```

You may also remove the obsolete `confirmStartLive` key (line 261) since the new flow no longer uses `window.confirm`.

- [ ] **Step 2: Add Spanish equivalents**

In `public/locales/es/admin.json`, mirror:

```json
"startConfirm": {
  "heading": "Iniciar simulacro",
  "subhead": "Elige la audiencia para {{name}}.",
  "audienceLabel": "Audiencia",
  "audienceEveryone": "Todos — el personal y los invitados con PIN ven el simulacro",
  "audienceStaffOnly": "Solo personal — los invitados con PIN siguen viendo el tablero normal",
  "confirm": "Iniciar simulacro",
  "cancel": "Cancelar"
}
```

- [ ] **Step 3: Update the loader to return `defaultAudience`**

In `app/routes/admin/drills.tsx`, replace the loader's `findMany`:

```ts
const templates = await prisma.drillTemplate.findMany({
  orderBy: { updatedAt: "desc" },
  select: { id: true, name: true, updatedAt: true, defaultAudience: true },
});
```

- [ ] **Step 4: Update the `start-live` action to accept `audience`**

In the same file, replace the existing `start-live` block (around lines 80-99):

```ts
  if (intent === "start-live") {
    const id = String(formData.get("id") ?? "");
    if (!id) {
      return dataWithError(null, t("drills.list.errors.missingId"));
    }
    const audience = parseDrillAudience(formData.get("audience"));
    const orgId = getOrgFromContext(context).id;
    const actor = getActorIdsFromContext(context);
    try {
      await startDrillRun(prisma, orgId, id, undefined, actor, audience);
    } catch (err) {
      if (err instanceof Response && err.status === 409) {
        return dataWithError(null, t("drills.list.errors.anotherLive"));
      }
      console.error("[drills.list] start-live failed", err);
      throw err;
    }
    throw redirect("/drills/live");
  }
```

Add the import:

```ts
import { parseDrillAudience, type DrillAudience } from "~/domain/drills/types";
```

- [ ] **Step 5: Replace the per-row Form with a Popover-driven version**

Find the existing per-template `<Form method="post" ...>` block (around lines 189-206). Replace it with a small `StartLivePopover` component used inline. Add at the top of the file (after the existing imports):

```tsx
import { Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { useFetcher } from "react-router";
import { useState } from "react";
```

Add this component near the bottom of the file (above or below `AdminDrillList`):

```tsx
function StartLivePopover({
  templateId,
  templateName,
  defaultAudience,
}: {
  templateId: string;
  templateName: string;
  defaultAudience: DrillAudience;
}) {
  const { t } = useTranslation("admin");
  const [audience, setAudience] = useState<DrillAudience>(defaultAudience);
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher();

  return (
    <Popover isOpen={open} onOpenChange={setOpen} placement="bottom-end">
      <PopoverTrigger>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 transition-colors"
        >
          <Radio className="w-3.5 h-3.5" />
          {t("drills.list.startLive")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0">
        <fetcher.Form method="post" className="flex flex-col gap-3 p-4 w-72">
          <input type="hidden" name="intent" value="start-live" />
          <input type="hidden" name="id" value={templateId} />
          <div>
            <h3 className="text-sm font-semibold">
              {t("drills.list.startConfirm.heading")}
            </h3>
            <p className="text-xs text-white/60 mt-0.5">
              {t("drills.list.startConfirm.subhead", { name: templateName })}
            </p>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-white/50">
              {t("drills.list.startConfirm.audienceLabel")}
            </legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="audience"
                value="EVERYONE"
                checked={audience === "EVERYONE"}
                onChange={() => setAudience("EVERYONE")}
              />
              <span>{t("drills.list.startConfirm.audienceEveryone")}</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="audience"
                value="STAFF_ONLY"
                checked={audience === "STAFF_ONLY"}
                onChange={() => setAudience("STAFF_ONLY")}
              />
              <span>{t("drills.list.startConfirm.audienceStaffOnly")}</span>
            </label>
          </fieldset>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="text-sm text-white/60 hover:text-white px-2"
              onClick={() => setOpen(false)}
            >
              {t("drills.list.startConfirm.cancel")}
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 transition-colors disabled:opacity-50"
              disabled={fetcher.state !== "idle"}
            >
              <Radio className="w-3.5 h-3.5" />
              {t("drills.list.startConfirm.confirm")}
            </button>
          </div>
        </fetcher.Form>
      </PopoverContent>
    </Popover>
  );
}
```

In the per-row JSX, replace the old `<Form>` block with:

```tsx
<StartLivePopover
  templateId={tpl.id}
  templateName={tpl.name}
  defaultAudience={(tpl.defaultAudience ?? "EVERYONE") as DrillAudience}
/>
```

- [ ] **Step 6: Run typecheck + tests**

Run: `npx react-router typegen && npm test`
Expected: all PASS.

- [ ] **Step 7: Smoke test**

Dev server: open `/admin/drills`, click "Start live drill" on a template, change radio to STAFF_ONLY, confirm. Expect redirect to `/drills/live` showing the staff-only audience badge in the banner.

- [ ] **Step 8: Commit**

```bash
git add app/routes/admin/drills.tsx public/locales/en/admin.json public/locales/es/admin.json
git commit -m "feat(drills): per-run audience picker on /admin/drills start-live"
```

---

## Task 8: `admin/drills.$templateId` — defaultAudience radio + start-live popover

**Files:**
- Modify: `app/routes/admin/drills.$templateId.tsx`
- Modify: `public/locales/en/admin.json`, `public/locales/es/admin.json`

- [ ] **Step 1: Add new i18n keys (English)**

In `public/locales/en/admin.json`, inside `drills.edit`, add:

```json
"defaultAudience": {
  "heading": "Audience for live runs",
  "help": "Default selection when an admin starts a live drill from this template. Admins can change it at start time.",
  "everyone": "Everyone — staff and viewer-pin guests",
  "staffOnly": "Staff only — viewer-pin guests see the normal board",
  "saveButton": "Save audience default",
  "saved": "Audience default saved."
},
"startConfirm": {
  "heading": "Start live drill",
  "audienceLabel": "Audience",
  "audienceEveryone": "Everyone — staff and viewer-pin guests see the takeover",
  "audienceStaffOnly": "Staff only — viewer-pin guests continue to see the normal board",
  "confirm": "Start live drill",
  "cancel": "Cancel"
}
```

- [ ] **Step 2: Add Spanish equivalents**

```json
"defaultAudience": {
  "heading": "Audiencia para simulacros en vivo",
  "help": "Selección predeterminada cuando un administrador inicia un simulacro desde esta plantilla. Se puede cambiar al iniciar.",
  "everyone": "Todos — personal e invitados con PIN",
  "staffOnly": "Solo personal — los invitados con PIN ven el tablero normal",
  "saveButton": "Guardar audiencia predeterminada",
  "saved": "Audiencia predeterminada guardada."
},
"startConfirm": {
  "heading": "Iniciar simulacro",
  "audienceLabel": "Audiencia",
  "audienceEveryone": "Todos — personal e invitados con PIN ven el simulacro",
  "audienceStaffOnly": "Solo personal — los invitados con PIN siguen viendo el tablero normal",
  "confirm": "Iniciar simulacro",
  "cancel": "Cancelar"
}
```

- [ ] **Step 3: Update loader to return `defaultAudience`**

In `app/routes/admin/drills.$templateId.tsx`, change the `findFirst`:

```ts
const template = await prisma.drillTemplate.findFirst({
  where: { id },
  select: {
    id: true,
    name: true,
    definition: true,
    updatedAt: true,
    defaultAudience: true,
  },
});
```

- [ ] **Step 4: Add new zod schema + action branches**

Below the existing `startLiveSchema`:

```ts
const setDefaultAudienceSchema = z.object({
  intent: z.literal("setDefaultAudience"),
  audience: z.enum(["STAFF_ONLY", "EVERYONE"]),
});

const startLiveWithAudienceSchema = z.object({
  intent: z.literal("start-live"),
  audience: z.enum(["STAFF_ONLY", "EVERYONE"]).default("EVERYONE"),
});
```

Replace the existing `startLiveSchema` with `startLiveWithAudienceSchema` everywhere it appears in the `parseIntent` map. Add `setDefaultAudience: setDefaultAudienceSchema` to the same map.

In the action body, **replace the existing `start-live` branch**:

```ts
    if (result.intent === "start-live") {
      const orgId = getOrgFromContext(context).id;
      const actor = getActorIdsFromContext(context);
      try {
        await startDrillRun(
          prisma,
          orgId,
          id,
          undefined,
          actor,
          result.data.audience,
        );
      } catch (err) {
        if (err instanceof Response && err.status === 409) {
          return dataWithError(null, t("drills.edit.errors.anotherLive"));
        }
        throw err;
      }
      throw redirect("/drills/live");
    }
```

**Add a new branch**:

```ts
    if (result.intent === "setDefaultAudience") {
      await prisma.drillTemplate.update({
        where: { id },
        data: { defaultAudience: result.data.audience },
      });
      return dataWithSuccess(null, t("drills.edit.defaultAudience.saved"));
    }
```

- [ ] **Step 5: Add the radio group UI in the component**

Near the existing rename form (search for `useAppForm(renameSchema, ...)`), add a separate small `<Form>`:

```tsx
import { Users } from "lucide-react";

// inside the component JSX, near the rename / save-layout area:
<section className="rounded-xl border border-white/10 bg-white/5 p-4">
  <div className="flex items-start gap-3">
    <Users className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
    <div className="flex-1">
      <h2 className="text-sm font-semibold text-white">
        {t("drills.edit.defaultAudience.heading")}
      </h2>
      <p className="text-white/50 text-xs mt-0.5">
        {t("drills.edit.defaultAudience.help")}
      </p>
    </div>
  </div>
  <Form method="post" className="flex flex-col gap-2 mt-3">
    <input type="hidden" name="intent" value="setDefaultAudience" />
    <label className="flex items-start gap-2 text-sm">
      <input
        type="radio"
        name="audience"
        value="EVERYONE"
        defaultChecked={template.defaultAudience !== "STAFF_ONLY"}
      />
      <span>{t("drills.edit.defaultAudience.everyone")}</span>
    </label>
    <label className="flex items-start gap-2 text-sm">
      <input
        type="radio"
        name="audience"
        value="STAFF_ONLY"
        defaultChecked={template.defaultAudience === "STAFF_ONLY"}
      />
      <span>{t("drills.edit.defaultAudience.staffOnly")}</span>
    </label>
    <button
      type="submit"
      className={`${formClasses.btnSecondary} self-start mt-2`}
    >
      {t("drills.edit.defaultAudience.saveButton")}
    </button>
  </Form>
</section>
```

- [ ] **Step 6: Replace the inline "Start live drill" form with a popover**

Find the existing `<liveFetcher.Form method="post">` block (around lines 491-501). Replace with a similar `StartLivePopover` (you can reuse the component from Task 7 by extracting it to `app/domain/drills/StartLivePopover.tsx` if you want, but it's also fine to copy/paste — the component is small and the two pages are independent route components).

If extracting: create `app/domain/drills/StartLivePopover.tsx`, move the component there, export it. Update both `admin/drills.tsx` and `admin/drills.$templateId.tsx` to import it. Default the `defaultAudience` prop.

If copying: paste the component above the default export of `drills.$templateId.tsx`. Then in JSX:

```tsx
<StartLivePopover
  templateId={template.id}
  templateName={template.name}
  defaultAudience={(template.defaultAudience ?? "EVERYONE") as DrillAudience}
/>
```

(Recommendation: extract to `app/domain/drills/StartLivePopover.tsx` to avoid duplication. Two pages using the same popover means a single source of truth for the UI.)

- [ ] **Step 7: Run typecheck + tests**

Run: `npx react-router typegen && npm test`
Expected: all PASS.

- [ ] **Step 8: Smoke test**

Dev server: visit a template's edit page. Set the default audience to STAFF_ONLY, save (toast should say "Audience default saved."). Click "Start live drill" — popover should pre-select STAFF_ONLY. Override to EVERYONE, confirm — redirect to `/drills/live` with EVERYONE banner badge.

- [ ] **Step 9: Commit**

```bash
git add app/routes/admin/drills.$templateId.tsx app/domain/drills/StartLivePopover.tsx app/routes/admin/drills.tsx public/locales/en/admin.json public/locales/es/admin.json
git commit -m "feat(drills): per-template defaultAudience + audience-aware start popover"
```

---

## Task 9: `admin/drills.history.$runId` — audience chip beside status

**Files:**
- Modify: `app/routes/admin/drills.history.$runId.tsx`
- Modify: `public/locales/en/admin.json`, `public/locales/es/admin.json`

- [ ] **Step 1: Add i18n keys**

`public/locales/en/admin.json`, inside `drillsHistory.replay`:

```json
"audience": {
  "everyone": "Audience: Everyone",
  "staffOnly": "Audience: Staff only"
}
```

`public/locales/es/admin.json`:

```json
"audience": {
  "everyone": "Audiencia: Todos",
  "staffOnly": "Audiencia: Solo personal"
}
```

- [ ] **Step 2: Surface `audience` from the loader**

In `app/routes/admin/drills.history.$runId.tsx`, the loader builds a `run` object passed to the component (around line 165). Add `audience: parseDrillAudience(run.audience)` to that object. Import `parseDrillAudience` from `~/domain/drills/types`.

- [ ] **Step 3: Add the `AudienceChip` component**

Below `StatusChip` (line 180), add:

```tsx
import { type DrillAudience } from "~/domain/drills/types";

function AudienceChip({ audience }: { audience: DrillAudience }) {
  const { t } = useTranslation("admin");
  const cls =
    audience === "STAFF_ONLY"
      ? "bg-blue-500/20 text-blue-200 border border-blue-500/40"
      : "bg-white/10 text-white/70 border border-white/20";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {audience === "STAFF_ONLY"
        ? t("drillsHistory.replay.audience.staffOnly")
        : t("drillsHistory.replay.audience.everyone")}
    </span>
  );
}
```

- [ ] **Step 4: Render it next to `StatusChip`**

In the component (around line 244), beside `<StatusChip status={run.status} />`:

```tsx
<StatusChip status={run.status} />
<AudienceChip audience={run.audience} />
```

- [ ] **Step 5: Run typecheck + tests**

Run: `npx react-router typegen && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add app/routes/admin/drills.history.$runId.tsx public/locales/en/admin.json public/locales/es/admin.json
git commit -m "feat(drills): show audience chip on /admin/drills/history/:runId"
```

---

## Task 10: Playwright e2e — audience-gated viewer-pin redirect

**Files:**
- Create: `e2e/drills-audience.spec.ts`

The repo's e2e harness lives under `e2e/`. Sample existing specs (e.g., a drills-related spec if one exists) for harness setup, fixtures, and how to seed an admin user + a viewer pin. If none exists, the spec below uses Playwright's default fixture.

- [ ] **Step 1: Read an existing e2e spec for setup conventions**

Run: `ls e2e/` and `head -60 e2e/<any-existing-spec>.ts`
Make a one-line note: which helper bootstraps an admin? Which seeds a viewer pin? Use those helpers below — do not hand-roll auth.

- [ ] **Step 2: Write the spec**

Create `e2e/drills-audience.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
// Replace with actual helpers from the existing e2e harness:
import { signInAsAdmin, openWithViewerPin } from "./helpers";

test.describe("Drill audience visibility", () => {
  test("STAFF_ONLY drill: viewer-pin guest stays on normal board", async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await signInAsAdmin(adminPage);

    // Start a STAFF_ONLY drill from the first template.
    await adminPage.goto("/admin/drills");
    const firstTemplate = adminPage.locator("li").first();
    await firstTemplate.getByRole("button", { name: /start live drill/i }).click();
    await adminPage.getByLabel(/staff only/i).check();
    await adminPage.getByRole("button", { name: /start live drill/i }).last().click();
    await expect(adminPage).toHaveURL(/\/drills\/live/);

    // Now open a viewer-pin context. They should NOT be redirected.
    const viewerCtx = await browser.newContext();
    const viewerPage = await viewerCtx.newPage();
    await openWithViewerPin(viewerPage);
    await viewerPage.goto("/");
    await expect(viewerPage).toHaveURL(/\/$/);
    // The car-line board's hallmark element (e.g. a tile grid) should be there:
    await expect(viewerPage.getByRole("region", { name: /board/i })).toBeVisible();

    // Cleanup: end the drill so the next test starts clean.
    await adminPage.getByRole("button", { name: /end drill/i }).click();
    await adminPage.on("dialog", (d) => d.accept());
  });

  test("EVERYONE drill: viewer-pin guest is redirected to /drills/live", async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await signInAsAdmin(adminPage);

    await adminPage.goto("/admin/drills");
    const firstTemplate = adminPage.locator("li").first();
    await firstTemplate.getByRole("button", { name: /start live drill/i }).click();
    await adminPage.getByLabel(/everyone/i).check();
    await adminPage.getByRole("button", { name: /start live drill/i }).last().click();
    await expect(adminPage).toHaveURL(/\/drills\/live/);

    const viewerCtx = await browser.newContext();
    const viewerPage = await viewerCtx.newPage();
    await openWithViewerPin(viewerPage);
    await viewerPage.goto("/");
    await expect(viewerPage).toHaveURL(/\/drills\/live/);

    await adminPage.getByRole("button", { name: /end drill/i }).click();
    await adminPage.on("dialog", (d) => d.accept());
  });
});
```

If `signInAsAdmin` / `openWithViewerPin` aren't named exactly that in the harness, swap to whatever the harness exposes. If no such helpers exist, write 5-line inline helpers at the top of the file rather than scaffold a new harness.

- [ ] **Step 3: Run the e2e suite**

Per `~/.claude/CLAUDE.md`, point Playwright cache at the ephemeral mount before installing:

```bash
export PLAYWRIGHT_BROWSERS_PATH="$(ls -d /sessions/*/mnt/outputs 2>/dev/null | head -1)/.ms-playwright"
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
npx playwright install chromium
npm run test:e2e -- drills-audience
```

Expected: both tests PASS.

If the harness doesn't yet support a viewer-pin helper, fall back to manual smoke (already covered in Task 5 Step 4). Note the limitation in the commit message.

- [ ] **Step 4: Clean up e2e artifacts per repo rules**

```bash
npm run clean:e2e || true
npm run clean:tmp || true
rm -rf ~/.cache/ms-playwright ~/.cache/pip ~/.npm /tmp/playwright-* /tmp/pw-* /tmp/.org.chromium.* /tmp/.X*-lock 2>/dev/null || true
```

- [ ] **Step 5: Commit**

```bash
git add e2e/drills-audience.spec.ts
git commit -m "test(e2e): drill audience-gating for viewer-pin guests"
```

---

## Task 11: Final verification + open PR

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 2: Run typecheck**

```bash
npx react-router typegen
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Build the app**

```bash
npm run build
```

Expected: success.

- [ ] **Step 4: Final smoke run on dev server**

Dev server: walk through the four scenarios one more time:
1. STAFF_ONLY drill → viewer-pin sees normal board, /drills/live 404s for them.
2. EVERYONE drill → viewer-pin sees /drills/live with EVERYONE badge.
3. Toggle some cells → "Saving…" → "Saved · just now" → fades. No toasts.
4. Pause / Resume / End → toasts work.
5. /admin/drills/history/:runId shows the audience chip.

- [ ] **Step 5: Push branch + open PR**

```bash
git push -u origin claude/sleepy-chaum-987e0f
gh pr create --title "feat(drills): per-drill audience visibility (staff-only vs everyone)" --body "$(cat <<'EOF'
## Summary
- Adds `DrillTemplate.defaultAudience` and `DrillRun.audience` (STAFF_ONLY | EVERYONE).
- Replaces the `userIsAdmin` redirect exemption with an audience-membership gate that covers staff AND viewer-pin guests.
- `/drills/live` 404s for viewer-pin guests excluded by a STAFF_ONLY audience.
- Drops the per-save "Saved" toast in favor of an inline "Saving…/Saved" indicator.
- Admin UI: per-template default-audience radio; per-run override popover when starting a live drill; audience chip on the history replay page.

Spec: docs/superpowers/specs/2026-04-27-drill-audience-visibility-design.md
Plan: docs/superpowers/plans/2026-04-27-drill-audience-visibility.md

## Test plan
- [ ] `npm test` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds
- [ ] Manual: STAFF_ONLY drill → viewer-pin sees normal board, /drills/live 404s
- [ ] Manual: EVERYONE drill → viewer-pin redirected to /drills/live
- [ ] Manual: cell toggles show inline "Saving…/Saved", no toasts
- [ ] Manual: pause/resume/end still toast
- [ ] Manual: history replay page shows audience chip

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

## Self-Review Checklist

Run through this after the plan is written. Fix issues inline.

- [ ] **Spec coverage:** Every section of the spec has at least one task.
  - Data model → Task 1.
  - Audience membership type → Task 3.
  - Redirect logic → Tasks 3 + 5.
  - Live drill page (404, badge, indicator) → Task 6.
  - Toast removal → Task 6.
  - Admin UI (template default + per-run override) → Tasks 7 + 8.
  - History audience badge → Task 9.
  - Migration order → Task 1.
  - Tests → Tasks 2, 3, 4, 10.
- [ ] **Placeholders:** No "TBD" / "TODO" / "implement appropriate handling".
- [ ] **Type consistency:**
  - `DrillAudience` defined in Task 2; used identically in Tasks 3-9.
  - `AudienceMembership` defined in Task 3; used identically in Task 5 + the inline `drills.live` membership union (which is a subset matching the same string literals).
  - `parseDrillAudience` defined in Task 2; used in Tasks 5, 6, 9, and (via zod enum) Tasks 7, 8.
  - `startDrillRun` signature change: introduced in Task 4; called with the new positional `audience` arg in Tasks 7 + 8.
  - `getActiveDrillRun` returns `audience` from Task 1's schema change; consumed in Tasks 5 + 6.
- [ ] **No orphan code:** The temporary `userIsAdmin` shim added in Task 3 Step 5 is explicitly removed in Task 6 Step 6.
- [ ] **Frequent commits:** every task ends with a `git commit`, 11 commits total.
