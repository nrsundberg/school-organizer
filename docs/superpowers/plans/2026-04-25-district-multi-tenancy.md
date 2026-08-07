# District-level Multi-Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `District` billing-parent entity that owns N schools, with a self-serve signup flow, role-routed admin portal at `pickuproster.com`, aggregate dashboards, audit-logged impersonation gate, and platform-staff controls — without weakening the existing per-school tenant isolation.

**Architecture:**
- New `District` and `DistrictAuditLog` tables; `Org.districtId` and `User.districtId` nullable FKs.
- District admins use a parallel query surface (`district-scope.server.ts`) that constructs a Prisma client *without* the tenant-extension and explicitly filters every query through `Org.districtId`. The tenant-extension at `app/db/tenant-extension.ts` is unchanged.
- Impersonation works by stamping `session.impersonatedOrgId`. The middleware that builds the per-request org context honors that stamp, so the existing tenant-extension scopes the request to the impersonated school with no per-route changes.
- Per-org Stripe routes early-return when `Org.districtId` is set; billing flows through the district's Stripe customer instead.

**Tech Stack:** React Router 7, Cloudflare Workers, Prisma + D1, better-auth, Stripe, Playwright, Node `--test` runner.

**Reference spec:** [`docs/superpowers/specs/2026-04-25-district-multi-tenancy-design.md`](../specs/2026-04-25-district-multi-tenancy-design.md)

---

## Conventions used in this plan

- Unit tests live next to source: `foo.ts` → `foo.test.ts`. They run via `npm test` (Node `--test`).
- Test glob in `package.json` lists each test directory explicitly. **New test directories must be appended to the `test` script** — flagged in the relevant tasks.
- E2E tests use Playwright in `e2e/`. Run via `npm run test:e2e`. Disk-heavy — see global rules in `~/.claude/CLAUDE.md` before running locally.
- Per-request Prisma: `getPrisma(context, orgId?)` from `app/db.server.ts`. With `orgId`, applies the tenant-extension. Without, gives the raw client (no scoping). Helpers `getTenantPrisma`, `getOptionalUserFromContext` etc. live in `app/domain/utils/global-context.server.ts`.
- Migrations: `npm run d1:create-migration <name>` then edit the generated SQL. Apply locally with `npm run d1:migrate`.
- Commit cadence: each task ends with a commit. Co-author trailer per repo norm.

---

## Phase 0 — Test infrastructure & invariant helpers

### Task 0.1: Add district fixtures and test runner glob

**Files:**
- Modify: `package.json` (test script glob)
- Create: `app/domain/district/.gitkeep` (placeholder so the dir exists)

- [ ] **Step 1: Inspect current `test` script**

Run: `grep '"test"' package.json`
Expected output: contains `app/domain/billing/*.test.ts app/domain/utils/*.test.ts ...`

- [ ] **Step 2: Append district test glob**

Edit `package.json`. Replace the existing `"test"` line:

```json
"test": "tsx --test app/domain/billing/*.test.ts app/domain/utils/*.test.ts app/lib/*.test.ts app/domain/drills/*.test.ts app/domain/csv/*.test.ts app/domain/auth/*.test.ts app/domain/district/*.test.ts app/db/*.test.ts",
```

- [ ] **Step 3: Create directory marker**

```bash
mkdir -p app/domain/district
touch app/domain/district/.gitkeep
```

- [ ] **Step 4: Verify glob matches no files yet (so glob is harmless)**

Run: `npm test`
Expected: passes — existing tests run, no new tests yet.

- [ ] **Step 5: Commit**

```bash
git add package.json app/domain/district/.gitkeep
git commit -m "test: register app/domain/district and app/db test globs"
```

---

## Phase 1 — Schema foundation

### Task 1.1: Add `District`, `DistrictAuditLog`, and FK columns to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Read current schema header**

Run: `head -20 prisma/schema.prisma`
Expected: confirms generator/datasource block.

- [ ] **Step 2: Add the `District` model after `OrgAuditLog`**

In `prisma/schema.prisma`, immediately after the `OrgAuditLog` block (around line 137), insert:

```prisma
model District {
  id                       String                    @id @default(cuid())
  name                     String
  slug                     String                    @unique
  logoUrl                  String?
  logoObjectKey            String?
  status                   OrgStatus                 @default(TRIALING)
  /// Soft cap. Districts that exceed are flagged in the staff panel; school
  /// creation is allowed but the district sees a banner and an audit-log
  /// entry is written.
  schoolCap                Int                       @default(3)
  stripeCustomerId         String?                   @unique
  stripeSubscriptionId     String?                   @unique
  subscriptionStatus       StripeSubscriptionStatus?
  billingPlan              BillingPlan               @default(DISTRICT)
  trialStartedAt           DateTime?
  /// Sales-set. No automatic enforcement at the district level — staff sets
  /// this manually from the platform admin panel.
  trialEndsAt              DateTime?
  pastDueSinceAt           DateTime?
  compedUntil              DateTime?
  isComped                 Boolean                   @default(false)
  billingNote              String?
  passwordResetEnabled     Boolean                   @default(true)
  defaultLocale            String                    @default("en")
  orgs                     Org[]
  users                    User[]
  auditLogs                DistrictAuditLog[]
  createdAt                DateTime                  @default(now())
  updatedAt                DateTime                  @updatedAt
}

model DistrictAuditLog {
  id           String   @id @default(cuid())
  districtId   String
  district     District @relation(fields: [districtId], references: [id], onDelete: Cascade)
  actorUserId  String?
  actorEmail   String?
  action       String
  targetType   String?
  targetId     String?
  details      String?  // JSON-encoded
  createdAt    DateTime @default(now())

  @@index([districtId, createdAt])
}
```

- [ ] **Step 3: Add `districtId` to `Org`**

In the `Org` model, add the field (after `defaultLocale`, before the relations block):

```prisma
  /// Optional FK to District. When set, the org's own Stripe and trial
  /// fields are unused — billing flows through the district. Plan caps
  /// still apply per-school (each school inherits CAMPUS-tier limits).
  districtId             String?
  district               District?                @relation(fields: [districtId], references: [id], onDelete: SetNull)
```

And add the index in the same model (Prisma auto-indexes single FKs but D1 prefers explicit):

```prisma
  @@index([districtId])
```

(Place the `@@index` immediately before the closing `}` of the `Org` model.)

- [ ] **Step 4: Add `districtId` to `User`**

In the `User` model, add:

```prisma
  /// Set for district admins. Mutually exclusive with orgId and isPlatformAdmin
  /// at the application layer (validated in better-auth hooks).
  districtId   String?
  district     District? @relation(fields: [districtId], references: [id], onDelete: SetNull)
```

Add `@@index([districtId])` before the closing `}`.

- [ ] **Step 5: Generate the Prisma client**

Run: `npx prisma generate`
Expected: regenerates `app/db/generated/client` with `District`, `DistrictAuditLog`, and the new FK fields.

- [ ] **Step 6: Verify TypeScript still compiles**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma app/db/generated
git commit -m "feat(schema): add District, DistrictAuditLog, Org.districtId, User.districtId"
```

### Task 1.2: Create and apply the D1 migration

**Files:**
- Create: `migrations/<next-number>_district_multi_tenancy.sql` (filename comes from `npm run d1:create-migration`)

- [ ] **Step 1: Create migration file**

Run: `npm run d1:create-migration district_multi_tenancy`
Expected: creates a numbered file under `migrations/`. Note the path printed.

- [ ] **Step 2: Write the migration SQL**

Replace the generated file's body with:

```sql
-- District table
CREATE TABLE "District" (
  "id"                     TEXT PRIMARY KEY NOT NULL,
  "name"                   TEXT NOT NULL,
  "slug"                   TEXT NOT NULL,
  "logoUrl"                TEXT,
  "logoObjectKey"          TEXT,
  "status"                 TEXT NOT NULL DEFAULT 'TRIALING',
  "schoolCap"              INTEGER NOT NULL DEFAULT 3,
  "stripeCustomerId"       TEXT,
  "stripeSubscriptionId"   TEXT,
  "subscriptionStatus"     TEXT,
  "billingPlan"            TEXT NOT NULL DEFAULT 'DISTRICT',
  "trialStartedAt"         DATETIME,
  "trialEndsAt"            DATETIME,
  "pastDueSinceAt"         DATETIME,
  "compedUntil"            DATETIME,
  "isComped"               INTEGER NOT NULL DEFAULT 0,
  "billingNote"            TEXT,
  "passwordResetEnabled"   INTEGER NOT NULL DEFAULT 1,
  "defaultLocale"          TEXT NOT NULL DEFAULT 'en',
  "createdAt"              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              DATETIME NOT NULL
);

CREATE UNIQUE INDEX "District_slug_key"             ON "District"("slug");
CREATE UNIQUE INDEX "District_stripeCustomerId_key" ON "District"("stripeCustomerId");
CREATE UNIQUE INDEX "District_stripeSubscriptionId_key" ON "District"("stripeSubscriptionId");

-- DistrictAuditLog table
CREATE TABLE "DistrictAuditLog" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "districtId"   TEXT NOT NULL,
  "actorUserId"  TEXT,
  "actorEmail"   TEXT,
  "action"       TEXT NOT NULL,
  "targetType"   TEXT,
  "targetId"     TEXT,
  "details"      TEXT,
  "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE CASCADE
);

CREATE INDEX "DistrictAuditLog_districtId_createdAt_idx"
  ON "DistrictAuditLog"("districtId", "createdAt");

-- Org.districtId
ALTER TABLE "Org" ADD COLUMN "districtId" TEXT REFERENCES "District"("id") ON DELETE SET NULL;
CREATE INDEX "Org_districtId_idx" ON "Org"("districtId");

-- User.districtId
ALTER TABLE "User" ADD COLUMN "districtId" TEXT REFERENCES "District"("id") ON DELETE SET NULL;
CREATE INDEX "User_districtId_idx" ON "User"("districtId");
```

- [ ] **Step 3: Apply the migration locally**

Run: `npm run d1:migrate`
Expected: "Applied N migration(s)" with the new file listed.

- [ ] **Step 4: Verify schema matches**

Run: `npx wrangler d1 execute <DB_NAME> --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('District','DistrictAuditLog');"`
(Substitute the actual D1 binding name — find it in `wrangler.toml` or `wrangler.jsonc` under `d1_databases`.)
Expected: both tables listed.

- [ ] **Step 5: Verify column adds**

Run: `npx wrangler d1 execute <DB_NAME> --local --command "PRAGMA table_info('Org');"`
Expected: includes `districtId` column.

Same for User: `PRAGMA table_info('User');` — includes `districtId`.

- [ ] **Step 6: Commit**

```bash
git add migrations/
git commit -m "feat(db): migration for District, DistrictAuditLog, and FK columns"
```

### Task 1.3: User XOR-invariant helper + tests

**Files:**
- Create: `app/domain/auth/user-scope.server.ts`
- Create: `app/domain/auth/user-scope.server.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/domain/auth/user-scope.server.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertUserScopeXor, classifyUserScope } from "./user-scope.server";

describe("user-scope XOR invariant", () => {
  it("rejects users with no scope set", () => {
    assert.throws(
      () => assertUserScopeXor({ orgId: null, districtId: null, isPlatformAdmin: false }),
      /User must have exactly one of orgId, districtId, or isPlatformAdmin set/,
    );
  });

  it("rejects users with orgId AND districtId", () => {
    assert.throws(
      () => assertUserScopeXor({ orgId: "o1", districtId: "d1", isPlatformAdmin: false }),
      /exactly one/,
    );
  });

  it("rejects users with orgId AND isPlatformAdmin", () => {
    assert.throws(
      () => assertUserScopeXor({ orgId: "o1", districtId: null, isPlatformAdmin: true }),
      /exactly one/,
    );
  });

  it("rejects users with districtId AND isPlatformAdmin", () => {
    assert.throws(
      () => assertUserScopeXor({ orgId: null, districtId: "d1", isPlatformAdmin: true }),
      /exactly one/,
    );
  });

  it("accepts orgId-only", () => {
    assert.doesNotThrow(() => assertUserScopeXor({ orgId: "o1", districtId: null, isPlatformAdmin: false }));
  });

  it("accepts districtId-only", () => {
    assert.doesNotThrow(() => assertUserScopeXor({ orgId: null, districtId: "d1", isPlatformAdmin: false }));
  });

  it("accepts isPlatformAdmin-only", () => {
    assert.doesNotThrow(() => assertUserScopeXor({ orgId: null, districtId: null, isPlatformAdmin: true }));
  });
});

describe("classifyUserScope", () => {
  it("returns 'school' for orgId users", () => {
    assert.equal(
      classifyUserScope({ orgId: "o1", districtId: null, isPlatformAdmin: false }),
      "school",
    );
  });
  it("returns 'district' for districtId users", () => {
    assert.equal(
      classifyUserScope({ orgId: null, districtId: "d1", isPlatformAdmin: false }),
      "district",
    );
  });
  it("returns 'platform' for platform admins", () => {
    assert.equal(
      classifyUserScope({ orgId: null, districtId: null, isPlatformAdmin: true }),
      "platform",
    );
  });
  it("returns 'unassigned' for users with no scope", () => {
    assert.equal(
      classifyUserScope({ orgId: null, districtId: null, isPlatformAdmin: false }),
      "unassigned",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern='user-scope'`
Expected: fails with module-not-found or similar.

- [ ] **Step 3: Implement the helper**

Create `app/domain/auth/user-scope.server.ts`:

```ts
export type UserScopeFields = {
  orgId: string | null;
  districtId: string | null;
  isPlatformAdmin: boolean;
};

export type UserScope = "school" | "district" | "platform" | "unassigned";

/**
 * Throws if the user does not have exactly one of `orgId`, `districtId`,
 * or `isPlatformAdmin` set. Prisma cannot model XOR; this is the
 * application-layer guarantor of the invariant.
 */
export function assertUserScopeXor(fields: UserScopeFields): void {
  const set = [
    fields.orgId != null,
    fields.districtId != null,
    fields.isPlatformAdmin === true,
  ].filter(Boolean).length;
  if (set !== 1) {
    throw new Error(
      "User must have exactly one of orgId, districtId, or isPlatformAdmin set.",
    );
  }
}

export function classifyUserScope(fields: UserScopeFields): UserScope {
  if (fields.isPlatformAdmin) return "platform";
  if (fields.districtId != null) return "district";
  if (fields.orgId != null) return "school";
  return "unassigned";
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --test-name-pattern='user-scope|classifyUserScope'`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/domain/auth/user-scope.server.ts app/domain/auth/user-scope.server.test.ts
git commit -m "feat(auth): user-scope XOR invariant helper"
```

### Task 1.4: Wire XOR invariant into better-auth user create/update

**Files:**
- Modify: `app/domain/auth/better-auth.server.ts`

- [ ] **Step 1: Read existing better-auth config to find hooks**

Run: `grep -n "before\|databaseHooks\|user:" app/domain/auth/better-auth.server.ts | head -30`

Expected: locates the `databaseHooks` block (better-auth's standard config slot for create/update guards). If absent, the hook section needs to be added — better-auth's docs show: `databaseHooks: { user: { create: { before: ... }, update: { before: ... } } }`.

- [ ] **Step 2: Add the import and hook**

In `app/domain/auth/better-auth.server.ts`, add at the top:

```ts
import { assertUserScopeXor } from "./user-scope.server";
```

In the `betterAuth({...})` config object, add (or extend) `databaseHooks`:

```ts
databaseHooks: {
  user: {
    create: {
      before: async (user: { orgId?: string | null; districtId?: string | null; isPlatformAdmin?: boolean | null }) => {
        // New users created via better-auth (signup, invite acceptance) must
        // resolve to exactly one scope. Some flows (e.g. "create user, then
        // attach to org in a transaction") create a User with no scope and
        // immediately update — better-auth allows skipping the invariant for
        // those by setting orgId/districtId post-create. To support both,
        // we only enforce when at least one scope field is present.
        if (user.orgId || user.districtId || user.isPlatformAdmin) {
          assertUserScopeXor({
            orgId: user.orgId ?? null,
            districtId: user.districtId ?? null,
            isPlatformAdmin: user.isPlatformAdmin === true,
          });
        }
        return { data: user };
      },
    },
    update: {
      before: async (user: { orgId?: string | null; districtId?: string | null; isPlatformAdmin?: boolean | null }) => {
        if (user.orgId !== undefined || user.districtId !== undefined || user.isPlatformAdmin !== undefined) {
          // Updates may patch only one field; the invariant should be
          // enforced on the resulting state, not the patch. The hook
          // doesn't have the full row, so we rely on application code
          // (onboarding, invite, district provisioning) to call
          // assertUserScopeXor explicitly before issuing updates.
          // No-op here. Keep the hook for symmetry / future strict mode.
        }
        return { data: user };
      },
    },
  },
},
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/domain/auth/better-auth.server.ts
git commit -m "feat(auth): wire XOR invariant into better-auth user create hook"
```

---

## Phase 2 — District core domain

### Task 2.1: District CRUD module + tests

**Files:**
- Create: `app/domain/district/district.server.ts`
- Create: `app/domain/district/district.server.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/domain/district/district.server.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { slugifyDistrictName } from "./district.server";

describe("slugifyDistrictName", () => {
  it("lowercases and dashes spaces", () => {
    assert.equal(slugifyDistrictName("Lake County Schools"), "lake-county-schools");
  });
  it("strips disallowed punctuation", () => {
    assert.equal(slugifyDistrictName("St. Paul's Diocese"), "st-pauls-diocese");
  });
  it("collapses multiple dashes", () => {
    assert.equal(slugifyDistrictName("a -- b"), "a-b");
  });
  it("trims leading/trailing dashes", () => {
    assert.equal(slugifyDistrictName(" - hello - "), "hello");
  });
  it("returns empty string for input with no slug-safe characters", () => {
    assert.equal(slugifyDistrictName("!!!"), "");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern='slugifyDistrict'`
Expected: fails (module not found).

- [ ] **Step 3: Implement minimal slugifier**

Create `app/domain/district/district.server.ts`:

```ts
import type { District } from "~/db";
import { getPrisma } from "~/db.server";

const SLUG_DISALLOWED = /[^a-z0-9-]+/g;
const COLLAPSE_DASHES = /-+/g;

export function slugifyDistrictName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(SLUG_DISALLOWED, "-")
    .replace(COLLAPSE_DASHES, "-")
    .replace(/^-+|-+$/g, "");
}

export type CreateDistrictInput = {
  name: string;
  requestedSlug?: string;
};

/**
 * Create a District in TRIALING status with default schoolCap. The first
 * district admin user is created separately by the signup flow; this
 * function only creates the District row.
 */
export async function createDistrict(
  context: any,
  input: CreateDistrictInput,
): Promise<District> {
  const db = getPrisma(context);
  const requested = input.requestedSlug ?? input.name;
  const slug = slugifyDistrictName(requested);
  if (!slug) {
    throw new Error("A valid district slug is required.");
  }
  const taken = await db.district.findUnique({ where: { slug } });
  if (taken) {
    throw new Error("That district slug is already taken.");
  }
  const trialStartedAt = new Date();
  return db.district.create({
    data: {
      name: input.name.trim(),
      slug,
      status: "TRIALING",
      schoolCap: 3,
      billingPlan: "DISTRICT",
      trialStartedAt,
    },
  });
}

export async function getDistrictById(context: any, id: string): Promise<District | null> {
  const db = getPrisma(context);
  return db.district.findUnique({ where: { id } });
}

export async function getDistrictBySlug(context: any, slug: string): Promise<District | null> {
  const db = getPrisma(context);
  return db.district.findUnique({ where: { slug } });
}

export async function getDistrictSchoolCount(context: any, districtId: string): Promise<number> {
  const db = getPrisma(context);
  return db.org.count({ where: { districtId } });
}

export async function isOverSchoolCap(context: any, district: District): Promise<boolean> {
  const count = await getDistrictSchoolCount(context, district.id);
  return count > district.schoolCap;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --test-name-pattern='slugifyDistrict'`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/domain/district/district.server.ts app/domain/district/district.server.test.ts
git commit -m "feat(district): create/get district + slugifier"
```

### Task 2.2: District audit-log writer + tests

**Files:**
- Create: `app/domain/district/audit.server.ts`
- Create: `app/domain/district/audit.server.test.ts`

- [ ] **Step 1: Write failing tests for the action enum guard**

Create `app/domain/district/audit.server.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DISTRICT_AUDIT_ACTIONS } from "./audit.server";

describe("DISTRICT_AUDIT_ACTIONS", () => {
  it("includes the documented actions", () => {
    const required = [
      "district.admin.invited",
      "district.admin.removed",
      "district.school.created",
      "district.school.cap.exceeded",
      "district.impersonate.start",
      "district.impersonate.end",
      "district.billing.note.changed",
      "district.schoolCap.changed",
      "district.trialEndsAt.changed",
      "district.comp.changed",
    ];
    for (const action of required) {
      assert.ok(DISTRICT_AUDIT_ACTIONS.includes(action), `missing action: ${action}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern='DISTRICT_AUDIT_ACTIONS'`
Expected: fails (module not found).

- [ ] **Step 3: Implement the writer**

Create `app/domain/district/audit.server.ts`:

```ts
import { getPrisma } from "~/db.server";

export const DISTRICT_AUDIT_ACTIONS = [
  "district.admin.invited",
  "district.admin.removed",
  "district.school.created",
  "district.school.cap.exceeded",
  "district.impersonate.start",
  "district.impersonate.end",
  "district.billing.note.changed",
  "district.schoolCap.changed",
  "district.trialEndsAt.changed",
  "district.comp.changed",
] as const;

export type DistrictAuditAction = (typeof DISTRICT_AUDIT_ACTIONS)[number];

export type WriteAuditInput = {
  districtId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: DistrictAuditAction;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
};

export async function writeDistrictAudit(
  context: any,
  input: WriteAuditInput,
): Promise<void> {
  const db = getPrisma(context);
  await db.districtAuditLog.create({
    data: {
      districtId: input.districtId,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      details: input.details ? JSON.stringify(input.details) : null,
    },
  });
}

export async function listDistrictAudit(
  context: any,
  districtId: string,
  limit = 100,
) {
  const db = getPrisma(context);
  return db.districtAuditLog.findMany({
    where: { districtId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --test-name-pattern='DISTRICT_AUDIT_ACTIONS'`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/domain/district/audit.server.ts app/domain/district/audit.server.test.ts
git commit -m "feat(district): audit log writer with action enum"
```

### Task 2.3: District-scope Prisma helper (raw client, no tenant-extension)

**Files:**
- Create: `app/domain/district/district-scope.server.ts`
- Create: `app/domain/district/district-scope.server.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/domain/district/district-scope.server.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSchoolFilter } from "./district-scope.server";

describe("buildSchoolFilter", () => {
  it("scopes by districtId on the org relation", () => {
    const filter = buildSchoolFilter("dist-123");
    assert.deepEqual(filter, { org: { districtId: "dist-123" } });
  });
  it("can be combined with a base where clause", () => {
    const base = { status: { not: "EMPTY" } };
    const combined = { ...base, ...buildSchoolFilter("dist-123") };
    assert.deepEqual(combined, { status: { not: "EMPTY" }, org: { districtId: "dist-123" } });
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- --test-name-pattern='buildSchoolFilter'`
Expected: fails (module not found).

- [ ] **Step 3: Implement the scope module**

Create `app/domain/district/district-scope.server.ts`:

```ts
import { getPrisma } from "~/db.server";
import type { PrismaClient } from "~/db";

/**
 * Returns a Prisma client *without* the tenant-extension applied. District
 * admin code paths must use this client and must include an explicit
 * `districtId` filter on every query — the tenant-extension is not
 * scoping these requests.
 *
 * Convention: call this only from inside `district-scope.server.ts` and
 * the route loaders that drive district-aggregate views. Do not export
 * the raw client from anywhere else.
 */
export function getDistrictDb(context: any): PrismaClient {
  return getPrisma(context); // raw client; no orgId argument
}

/**
 * Helper for building the `{ org: { districtId } }` join filter used on
 * every cross-school read. Centralized so a code review can confirm
 * coverage at a glance.
 */
export function buildSchoolFilter(districtId: string) {
  return { org: { districtId } };
}

export async function listSchoolsForDistrict(
  context: any,
  districtId: string,
) {
  const db = getDistrictDb(context);
  return db.org.findMany({
    where: { districtId },
    orderBy: { name: "asc" },
  });
}

export async function getSchoolCountsForDistrict(
  context: any,
  districtId: string,
) {
  const db = getDistrictDb(context);
  const orgs = await db.org.findMany({
    where: { districtId },
    select: { id: true, name: true, slug: true, status: true },
  });
  const orgIds = orgs.map((o) => o.id);
  if (orgIds.length === 0) return [];

  const [students, families, classrooms, lastCalls] = await Promise.all([
    db.student.groupBy({ by: ["orgId"], where: { orgId: { in: orgIds } }, _count: true }),
    db.household.groupBy({ by: ["orgId"], where: { orgId: { in: orgIds } }, _count: true }),
    db.space.groupBy({ by: ["orgId"], where: { orgId: { in: orgIds } }, _count: true }),
    db.callEvent.groupBy({
      by: ["orgId"],
      where: { orgId: { in: orgIds } },
      _max: { createdAt: true },
    }),
  ]);

  const byOrg = new Map<string, { students: number; families: number; classrooms: number; lastCallAt: Date | null }>();
  for (const id of orgIds) {
    byOrg.set(id, { students: 0, families: 0, classrooms: 0, lastCallAt: null });
  }
  for (const row of students)   byOrg.get(row.orgId)!.students   = row._count as unknown as number;
  for (const row of families)   byOrg.get(row.orgId)!.families   = row._count as unknown as number;
  for (const row of classrooms) byOrg.get(row.orgId)!.classrooms = row._count as unknown as number;
  for (const row of lastCalls)  byOrg.get(row.orgId)!.lastCallAt = row._max.createdAt ?? null;

  return orgs.map((o) => ({ ...o, ...byOrg.get(o.id)! }));
}

export async function getDistrictRollup(
  context: any,
  districtId: string,
): Promise<{
  totalStudents: number;
  totalFamilies: number;
  totalClassrooms: number;
  callsLast7d: number;
  callsLast30d: number;
  activeSchools: number;
}> {
  const db = getDistrictDb(context);
  const filter = buildSchoolFilter(districtId);
  const now = Date.now();
  const SEVEN = new Date(now - 7  * 24 * 60 * 60 * 1000);
  const THIRTY = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const [students, families, classrooms, calls7d, calls30d, activeSchools] = await Promise.all([
    db.student.count({ where: filter }),
    db.household.count({ where: filter }),
    db.space.count({ where: filter }),
    db.callEvent.count({ where: { ...filter, createdAt: { gte: SEVEN } } }),
    db.callEvent.count({ where: { ...filter, createdAt: { gte: THIRTY } } }),
    db.callEvent
      .groupBy({
        by: ["orgId"],
        where: { ...filter, createdAt: { gte: THIRTY } },
        _count: true,
      })
      .then((rows) => rows.length),
  ]);

  return {
    totalStudents: students,
    totalFamilies: families,
    totalClassrooms: classrooms,
    callsLast7d: calls7d,
    callsLast30d: calls30d,
    activeSchools,
  };
}
```

- [ ] **Step 4: Run unit tests pass**

Run: `npm test -- --test-name-pattern='buildSchoolFilter'`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/domain/district/district-scope.server.ts app/domain/district/district-scope.server.test.ts
git commit -m "feat(district): aggregate-scope queries via non-extended Prisma client"
```

### Task 2.4: Soft school-cap detection helper + audit trigger

**Files:**
- Modify: `app/domain/district/district.server.ts`
- Modify: `app/domain/district/district.server.test.ts`

- [ ] **Step 1: Add failing test for cap-exceeded check**

Append to `app/domain/district/district.server.test.ts`:

```ts
import { computeCapState } from "./district.server";

describe("computeCapState", () => {
  it("returns 'within' when count < cap", () => {
    assert.deepEqual(computeCapState(2, 3), { state: "within", count: 2, cap: 3, over: 0 });
  });
  it("returns 'at' when count == cap", () => {
    assert.deepEqual(computeCapState(3, 3), { state: "at", count: 3, cap: 3, over: 0 });
  });
  it("returns 'over' with delta when count > cap", () => {
    assert.deepEqual(computeCapState(5, 3), { state: "over", count: 5, cap: 3, over: 2 });
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- --test-name-pattern='computeCapState'`
Expected: fails (export missing).

- [ ] **Step 3: Add helper to `district.server.ts`**

Append to `app/domain/district/district.server.ts`:

```ts
export type CapState = {
  state: "within" | "at" | "over";
  count: number;
  cap: number;
  over: number;
};

export function computeCapState(count: number, cap: number): CapState {
  if (count < cap) return { state: "within", count, cap, over: 0 };
  if (count === cap) return { state: "at", count, cap, over: 0 };
  return { state: "over", count, cap, over: count - cap };
}
```

- [ ] **Step 4: Run tests pass**

Run: `npm test -- --test-name-pattern='computeCapState'`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/domain/district/district.server.ts app/domain/district/district.server.test.ts
git commit -m "feat(district): cap-state helper for soft-cap UI"
```

---

## Phase 3 — Auth, session resolution, role routing

### Task 3.1: Add `impersonatedOrgId` to session

**Files:**
- Modify: `app/domain/auth/better-auth.server.ts`

- [ ] **Step 1: Identify the better-auth session config**

Run: `grep -n "session\|additionalFields" app/domain/auth/better-auth.server.ts | head -20`

Expected: locates either an existing `session: { ... }` or `user: { additionalFields: ... }` block, or shows that the default schema is in use.

- [ ] **Step 2: Add session additional field**

In `app/domain/auth/better-auth.server.ts`, inside the `betterAuth({ ... })` config, add (or extend) the session config:

```ts
session: {
  additionalFields: {
    impersonatedOrgId: {
      type: "string",
      required: false,
      defaultValue: null,
      input: false, // not settable from the client
    },
  },
},
```

If a `session` block already exists, merge `additionalFields` in.

- [ ] **Step 3: Add a migration for the new column**

Run: `npm run d1:create-migration session_impersonated_org`

Edit the new migration file:

```sql
ALTER TABLE "Session" ADD COLUMN "impersonatedOrgId" TEXT;
```

- [ ] **Step 4: Apply migration**

Run: `npm run d1:migrate`
Expected: applies cleanly.

- [ ] **Step 5: Verify column exists**

Run: `npx wrangler d1 execute <DB_NAME> --local --command "PRAGMA table_info('Session');"`
Expected: includes `impersonatedOrgId`.

- [ ] **Step 6: Commit**

```bash
git add app/domain/auth/better-auth.server.ts migrations/
git commit -m "feat(auth): add impersonatedOrgId to Session"
```

### Task 3.2: Impersonation start/end logic + tests

**Files:**
- Create: `app/domain/district/impersonation.server.ts`
- Create: `app/domain/district/impersonation.server.test.ts`

- [ ] **Step 1: Write failing tests for the validation helpers**

Create `app/domain/district/impersonation.server.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canImpersonate } from "./impersonation.server";

describe("canImpersonate", () => {
  const baseUser = { id: "u1", districtId: "d1", orgId: null, isPlatformAdmin: false };

  it("allows district admin -> school in same district", () => {
    const result = canImpersonate(baseUser, { id: "o1", districtId: "d1" });
    assert.deepEqual(result, { ok: true });
  });
  it("rejects district admin -> school in different district", () => {
    const result = canImpersonate(baseUser, { id: "o1", districtId: "d2" });
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; reason: string }).reason, /different district/);
  });
  it("rejects district admin -> standalone school", () => {
    const result = canImpersonate(baseUser, { id: "o1", districtId: null });
    assert.equal(result.ok, false);
  });
  it("rejects non-district-admin", () => {
    const user = { id: "u1", districtId: null, orgId: "o1", isPlatformAdmin: false };
    const result = canImpersonate(user, { id: "o2", districtId: "d1" });
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; reason: string }).reason, /not a district admin/);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- --test-name-pattern='canImpersonate'`
Expected: fails (module not found).

- [ ] **Step 3: Implement the module**

Create `app/domain/district/impersonation.server.ts`:

```ts
import { getPrisma } from "~/db.server";
import { writeDistrictAudit } from "./audit.server";

type Caller = {
  id: string;
  districtId: string | null;
  orgId: string | null;
  isPlatformAdmin: boolean;
};
type Target = { id: string; districtId: string | null };

export type CanImpersonateResult = { ok: true } | { ok: false; reason: string };

export function canImpersonate(caller: Caller, target: Target): CanImpersonateResult {
  if (!caller.districtId) {
    return { ok: false, reason: "Caller is not a district admin." };
  }
  if (target.districtId == null) {
    return { ok: false, reason: "Target school is not part of any district." };
  }
  if (target.districtId !== caller.districtId) {
    return { ok: false, reason: "Target school belongs to a different district." };
  }
  return { ok: true };
}

export async function startImpersonation(
  context: any,
  args: { caller: Caller & { email?: string | null }; sessionId: string; orgId: string },
): Promise<{ orgId: string; orgSlug: string; orgName: string }> {
  const db = getPrisma(context);
  const target = await db.org.findUnique({ where: { id: args.orgId } });
  if (!target) throw new Error("School not found.");
  const check = canImpersonate(args.caller, { id: target.id, districtId: target.districtId });
  if (!check.ok) throw new Error(check.reason);

  await db.session.update({
    where: { id: args.sessionId },
    data: { impersonatedOrgId: target.id },
  });
  await writeDistrictAudit(context, {
    districtId: args.caller.districtId!,
    actorUserId: args.caller.id,
    actorEmail: args.caller.email ?? null,
    action: "district.impersonate.start",
    targetType: "Org",
    targetId: target.id,
    details: { orgSlug: target.slug, orgName: target.name },
  });

  return { orgId: target.id, orgSlug: target.slug, orgName: target.name };
}

export async function endImpersonation(
  context: any,
  args: { caller: Caller & { email?: string | null }; sessionId: string },
): Promise<void> {
  const db = getPrisma(context);
  const session = await db.session.findUnique({ where: { id: args.sessionId } });
  const orgId = (session as { impersonatedOrgId?: string | null } | null)?.impersonatedOrgId ?? null;
  await db.session.update({
    where: { id: args.sessionId },
    data: { impersonatedOrgId: null },
  });
  if (args.caller.districtId && orgId) {
    await writeDistrictAudit(context, {
      districtId: args.caller.districtId,
      actorUserId: args.caller.id,
      actorEmail: args.caller.email ?? null,
      action: "district.impersonate.end",
      targetType: "Org",
      targetId: orgId,
    });
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- --test-name-pattern='canImpersonate'`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/domain/district/impersonation.server.ts app/domain/district/impersonation.server.test.ts
git commit -m "feat(district): impersonation start/end with audit logging"
```

### Task 3.3: Honor `impersonatedOrgId` in `globalStorageMiddleware`

**Files:**
- Modify: `app/domain/utils/global-context.server.ts`

- [ ] **Step 1: Read the middleware to find the user/org resolution block**

Run: `sed -n '70,140p' app/domain/utils/global-context.server.ts`
Expected: shows the section that sets `org` from `user?.orgId` after the host-based resolution.

- [ ] **Step 2: Replace the user/org resolution to honor session impersonation**

Find the block in `globalStorageMiddleware` that reads the better-auth session and resolves `user`. After loading the session, capture `impersonatedOrgId`:

```ts
let impersonatedOrgId: string | null = null;
try {
  const auth = getAuth(context);
  const session = await auth.api.getSession({ headers: request.headers });
  if (session?.user?.id) {
    user = await db.user.findUnique({ where: { id: session.user.id } });
    if (user?.role === "CALLER") {
      user = await db.user.update({
        where: { id: user.id },
        data: { role: "CONTROLLER" },
      });
    }
    impersonatedOrgId = (session.session as { impersonatedOrgId?: string | null } | null)?.impersonatedOrgId ?? null;
  }
} catch {
  // No session — that's fine, board is public
}
```

(Adjust to the existing variable names — the diff is: capture `impersonatedOrgId` from the session.)

Then update the org-resolution fallback to honor impersonation:

```ts
const onMarketingHost = isMarketingHost(request, context);
if (!onMarketingHost && !org) {
  // Impersonation takes precedence: when a district admin (or platform admin)
  // has an active impersonation, the request operates as that org.
  if (impersonatedOrgId) {
    org = await db.org.findUnique({ where: { id: impersonatedOrgId } });
  } else if (user?.orgId) {
    org = await db.org.findUnique({ where: { id: user.orgId } });
  }
}
```

- [ ] **Step 3: Export the impersonation flag for downstream use (banner)**

Add a third context key at the top of the file (next to `userContext`, `orgContext`):

```ts
export const impersonationContext = createContext<{ active: boolean; orgId: string | null } | null>(null);

export const getImpersonationFromContext = (context: any) => {
  return context.get(impersonationContext) ?? { active: false, orgId: null };
};
```

And inside the middleware, set it after `org`:

```ts
context.set(impersonationContext, {
  active: impersonatedOrgId != null,
  orgId: impersonatedOrgId,
});
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Run all unit tests**

Run: `npm test`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add app/domain/utils/global-context.server.ts
git commit -m "feat(auth): impersonatedOrgId takes precedence over user.orgId in middleware"
```

### Task 3.4: Login post-redirect role routing

**Files:**
- Modify: the better-auth post-signin redirect handler (locate via `grep`)

- [ ] **Step 1: Locate the post-login redirect**

Run: `grep -rn "after.*sign.*in\|post.*login\|signIn.*redirect\|onSignIn" app --include="*.ts" --include="*.tsx" | head`

Expected: locates either a route like `app/routes/auth/login.tsx`'s action, or a hook in `better-auth.server.ts`. The redirect probably happens after a successful sign-in form submit.

- [ ] **Step 2: Read the current handler**

Open the located file and identify where the redirect target is computed.

- [ ] **Step 3: Update to route by user scope**

Replace the redirect-target logic with:

```ts
import { classifyUserScope } from "~/domain/auth/user-scope.server";

// after sign-in succeeds and we have `user` loaded from db:
const scope = classifyUserScope({
  orgId: user.orgId,
  districtId: user.districtId,
  isPlatformAdmin: user.isPlatformAdmin === true,
});
let target: string;
switch (scope) {
  case "platform": target = "/admin"; break;
  case "district": target = "/district"; break;
  case "school":   target = "/admin"; break; // existing per-org admin
  case "unassigned": target = "/billing-required"; break; // or "/onboarding"
}
return redirect(target);
```

(If the existing handler already redirects to `/admin` for school admins, just add the district branch ahead of it. Don't break the existing behavior for `school` scope.)

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add <touched-files>
git commit -m "feat(auth): route by user scope on post-login redirect"
```

### Task 3.5: District route guard helper

**Files:**
- Create: `app/domain/district/route-guard.server.ts`
- Create: `app/domain/district/route-guard.server.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/domain/district/route-guard.server.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDistrictGuardOutcome } from "./route-guard.server";

describe("resolveDistrictGuardOutcome", () => {
  it("redirects to /login when no user", () => {
    const r = resolveDistrictGuardOutcome(null);
    assert.deepEqual(r, { kind: "redirect", to: "/login" });
  });
  it("redirects to /admin for school admins", () => {
    const r = resolveDistrictGuardOutcome({ orgId: "o1", districtId: null, isPlatformAdmin: false });
    assert.deepEqual(r, { kind: "redirect", to: "/admin" });
  });
  it("allows platform admins through (they need district visibility too)", () => {
    const r = resolveDistrictGuardOutcome({ orgId: null, districtId: null, isPlatformAdmin: true });
    assert.equal(r.kind, "allow-platform");
  });
  it("allows district admins through with their districtId", () => {
    const r = resolveDistrictGuardOutcome({ orgId: null, districtId: "d1", isPlatformAdmin: false });
    assert.deepEqual(r, { kind: "allow-district", districtId: "d1" });
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- --test-name-pattern='resolveDistrictGuardOutcome'`
Expected: fails.

- [ ] **Step 3: Implement**

Create `app/domain/district/route-guard.server.ts`:

```ts
import { redirect } from "react-router";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

export type DistrictGuardOutcome =
  | { kind: "redirect"; to: string }
  | { kind: "allow-district"; districtId: string }
  | { kind: "allow-platform" };

type GuardableUser = { orgId: string | null; districtId: string | null; isPlatformAdmin: boolean } | null;

export function resolveDistrictGuardOutcome(user: GuardableUser): DistrictGuardOutcome {
  if (!user) return { kind: "redirect", to: "/login" };
  if (user.isPlatformAdmin) return { kind: "allow-platform" };
  if (user.districtId) return { kind: "allow-district", districtId: user.districtId };
  if (user.orgId) return { kind: "redirect", to: "/admin" };
  return { kind: "redirect", to: "/login" };
}

/** Convenience for route loaders: throws a redirect or returns the districtId. */
export function requireDistrictAdmin(context: any): string {
  const user = getOptionalUserFromContext(context);
  const outcome = resolveDistrictGuardOutcome(user);
  if (outcome.kind === "redirect") throw redirect(outcome.to);
  if (outcome.kind === "allow-platform") {
    // Platform admins must use ?asDistrict=<id> on district routes; here we
    // throw to signal the caller should resolve which district to show.
    throw new Response("Use the staff panel to view a specific district.", { status: 400 });
  }
  return outcome.districtId;
}
```

- [ ] **Step 4: Run tests pass**

Run: `npm test -- --test-name-pattern='resolveDistrictGuardOutcome'`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/domain/district/route-guard.server.ts app/domain/district/route-guard.server.test.ts
git commit -m "feat(district): route-guard helper for /district/* loaders"
```

---

## Phase 4 — District portal: provisioning surface

### Task 4.1: District signup landing route

**Files:**
- Create: `app/routes/district.signup.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { redirect } from "react-router";
import type { Route } from "./+types/district.signup";
import { createDistrict } from "~/domain/district/district.server";
import { writeDistrictAudit } from "~/domain/district/audit.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { getPrisma } from "~/db.server";

export function loader() {
  return null;
}

export default function DistrictSignup() {
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Sign up your district</h1>
      <p className="mt-2 text-sm text-gray-600">
        Provision schools for your district from one portal. One bill,
        aggregate visibility, audit-logged access.
      </p>
      <form method="post" className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">District name</span>
          <input name="districtName" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Your name</span>
          <input name="adminName" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input name="adminEmail" type="email" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input name="adminPassword" type="password" required minLength={10} className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <button type="submit" className="w-full rounded bg-black px-4 py-2 text-white">Create district</button>
      </form>
    </main>
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const districtName = String(form.get("districtName") ?? "").trim();
  const adminName    = String(form.get("adminName") ?? "").trim();
  const adminEmail   = String(form.get("adminEmail") ?? "").trim().toLowerCase();
  const adminPassword= String(form.get("adminPassword") ?? "");
  if (!districtName || !adminName || !adminEmail || adminPassword.length < 10) {
    return new Response("Missing or invalid fields", { status: 400 });
  }

  const district = await createDistrict(context, { name: districtName });

  // Create the first district admin via better-auth (so password hashing
  // and email verification flow match the rest of the app).
  const auth = getAuth(context);
  const signup = await auth.api.signUpEmail({
    body: { name: adminName, email: adminEmail, password: adminPassword },
  });
  if (!signup?.user?.id) {
    throw new Response("Could not create district admin user.", { status: 500 });
  }

  // Attach districtId to the new user (better-auth doesn't expose this on signup).
  const db = getPrisma(context);
  await db.user.update({
    where: { id: signup.user.id },
    data: { districtId: district.id, role: "ADMIN" },
  });

  await writeDistrictAudit(context, {
    districtId: district.id,
    actorUserId: signup.user.id,
    actorEmail: adminEmail,
    action: "district.admin.invited",
    details: { firstAdmin: true },
  });

  return redirect("/district");
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Smoke-test the loader manually if dev server is running**

Run: `npm run dev` in another terminal. Navigate to `http://localhost:5173/district/signup`.
Expected: form renders.

- [ ] **Step 4: Commit**

```bash
git add app/routes/district.signup.tsx
git commit -m "feat(district): self-serve signup landing route"
```

### Task 4.2: District portal layout shell

**Files:**
- Create: `app/routes/district._layout.tsx`

- [ ] **Step 1: Create the layout**

```tsx
import { Outlet, NavLink } from "react-router";
import type { Route } from "./+types/district._layout";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getDistrictById } from "~/domain/district/district.server";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const district = await getDistrictById(context, districtId);
  if (!district) throw new Response("District not found", { status: 404 });
  return { district };
}

export default function DistrictLayout({ loaderData }: Route.ComponentProps) {
  const { district } = loaderData;
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4 flex items-center gap-4">
        {district.logoUrl ? (
          <img src={district.logoUrl} alt="" className="h-8 w-8 rounded" />
        ) : null}
        <h1 className="text-lg font-semibold">{district.name}</h1>
        <span className="text-xs text-gray-500 px-2 py-0.5 rounded bg-gray-100">
          {district.status}
        </span>
      </header>
      <nav className="border-b bg-white px-6 py-2 flex gap-4 text-sm">
        <NavLink to="/district" end className={({ isActive }) => isActive ? "font-semibold" : ""}>Dashboard</NavLink>
        <NavLink to="/district/schools"  className={({ isActive }) => isActive ? "font-semibold" : ""}>Schools</NavLink>
        <NavLink to="/district/admins"   className={({ isActive }) => isActive ? "font-semibold" : ""}>Admins</NavLink>
        <NavLink to="/district/billing"  className={({ isActive }) => isActive ? "font-semibold" : ""}>Billing</NavLink>
        <NavLink to="/district/audit"    className={({ isActive }) => isActive ? "font-semibold" : ""}>Audit log</NavLink>
      </nav>
      <main className="p-6"><Outlet /></main>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/routes/district._layout.tsx
git commit -m "feat(district): portal layout shell with role guard"
```

### Task 4.3: Schools index page

**Files:**
- Create: `app/routes/district.schools._index.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { Link } from "react-router";
import type { Route } from "./+types/district.schools._index";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getDistrictById, computeCapState } from "~/domain/district/district.server";
import { getSchoolCountsForDistrict } from "~/domain/district/district-scope.server";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const [district, schools] = await Promise.all([
    getDistrictById(context, districtId),
    getSchoolCountsForDistrict(context, districtId),
  ]);
  if (!district) throw new Response("District not found", { status: 404 });
  const cap = computeCapState(schools.length, district.schoolCap);
  return { district, schools, cap };
}

export default function DistrictSchools({ loaderData }: Route.ComponentProps) {
  const { schools, cap } = loaderData;
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Schools ({cap.count} of {cap.cap})</h2>
        <Link to="/district/schools/new" className="rounded bg-black px-3 py-1.5 text-sm text-white">
          Add school
        </Link>
      </div>
      {cap.state === "over" ? (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          You're {cap.over} over your contracted school cap. Your account
          manager will be in touch.
        </div>
      ) : null}
      <table className="w-full text-sm">
        <thead className="text-left">
          <tr><th>School</th><th>Status</th><th>Students</th><th>Families</th><th>Classrooms</th><th>Last activity</th><th></th></tr>
        </thead>
        <tbody>
          {schools.map((s) => (
            <tr key={s.id} className="border-t">
              <td className="py-2">{s.name}</td>
              <td>{s.status}</td>
              <td>{s.students}</td>
              <td>{s.families}</td>
              <td>{s.classrooms}</td>
              <td>{s.lastCallAt ? new Date(s.lastCallAt).toLocaleDateString() : "—"}</td>
              <td><Link to={`/district/schools/${s.id}`} className="underline">Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/routes/district.schools._index.tsx
git commit -m "feat(district): schools index with cap-state banner"
```

### Task 4.4: District-driven school creation (form + handler)

**Files:**
- Create: `app/routes/district.schools.new.tsx`
- Create: `app/domain/district/provision-school.server.ts`
- Create: `app/domain/district/provision-school.server.test.ts`

- [ ] **Step 1: Write failing tests for the provisioning helper**

Create `app/domain/district/provision-school.server.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateSchoolProvisioningInput } from "./provision-school.server";

describe("validateSchoolProvisioningInput", () => {
  it("requires school name", () => {
    assert.throws(() => validateSchoolProvisioningInput({ schoolName: "", schoolSlug: "abc", adminEmail: "a@b.co", adminName: "A" }), /name/);
  });
  it("requires slug", () => {
    assert.throws(() => validateSchoolProvisioningInput({ schoolName: "X", schoolSlug: "", adminEmail: "a@b.co", adminName: "A" }), /slug/);
  });
  it("requires admin email", () => {
    assert.throws(() => validateSchoolProvisioningInput({ schoolName: "X", schoolSlug: "x", adminEmail: "", adminName: "A" }), /email/);
  });
  it("returns normalized inputs", () => {
    const r = validateSchoolProvisioningInput({ schoolName: "  X  ", schoolSlug: "X-Y", adminEmail: "A@B.co", adminName: " A " });
    assert.deepEqual(r, { schoolName: "X", schoolSlug: "x-y", adminEmail: "a@b.co", adminName: "A" });
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- --test-name-pattern='validateSchoolProvisioningInput'`
Expected: fails.

- [ ] **Step 3: Implement provisioning helper**

Create `app/domain/district/provision-school.server.ts`:

```ts
import type { Org, District } from "~/db";
import { getPrisma } from "~/db.server";
import { slugifyOrgName } from "~/lib/org-slug";
import { writeDistrictAudit } from "./audit.server";
import { computeCapState, getDistrictSchoolCount } from "./district.server";
import { enqueueEmail } from "~/domain/email/queue.server";
import { getAuth } from "~/domain/auth/better-auth.server";

export type ProvisionInput = {
  schoolName: string;
  schoolSlug: string;
  adminEmail: string;
  adminName: string;
};

export function validateSchoolProvisioningInput(raw: ProvisionInput): ProvisionInput {
  const schoolName = raw.schoolName.trim();
  const schoolSlug = slugifyOrgName(raw.schoolSlug);
  const adminEmail = raw.adminEmail.trim().toLowerCase();
  const adminName = raw.adminName.trim();
  if (!schoolName) throw new Error("School name is required.");
  if (!schoolSlug) throw new Error("Valid school slug is required.");
  if (!adminEmail) throw new Error("Admin email is required.");
  if (!adminName) throw new Error("Admin name is required.");
  return { schoolName, schoolSlug, adminEmail, adminName };
}

/**
 * Create a school under a district. Reuses the existing onboarding pipeline
 * intentionally — the school admin should land on a working board.
 *
 * Soft cap: if the district is at/over its `schoolCap`, the school is still
 * created and an audit-log entry is written. The district sees a banner.
 */
export async function provisionSchoolForDistrict(
  context: any,
  args: {
    district: District;
    actor: { id: string; email: string };
    input: ProvisionInput;
  },
): Promise<{ org: Org; capExceeded: boolean }> {
  const input = validateSchoolProvisioningInput(args.input);
  const db = getPrisma(context);

  const slugTaken = await db.org.findUnique({ where: { slug: input.schoolSlug } });
  if (slugTaken) throw new Error("That school slug is already in use.");

  const beforeCount = await getDistrictSchoolCount(context, args.district.id);
  const beforeCap = computeCapState(beforeCount, args.district.schoolCap);

  // Create the org. Status EMPTY until the school admin signs in and runs
  // the existing onboarding pipeline (default board / settings) on first
  // load. Reusing the existing onboarding code path is what guarantees the
  // school admin lands on a working board — DO NOT fork this to a custom
  // path.
  const org = await db.org.create({
    data: {
      name: input.schoolName,
      slug: input.schoolSlug,
      billingPlan: "DISTRICT",
      status: "EMPTY",
      districtId: args.district.id,
    },
  });

  // Create the school admin via better-auth, then attach orgId.
  const auth = getAuth(context);
  // Generate a one-time password — the user resets it on first login.
  const tempPassword = crypto.randomUUID() + "Aa1!";
  const signup = await auth.api.signUpEmail({
    body: { name: input.adminName, email: input.adminEmail, password: tempPassword },
  });
  if (!signup?.user?.id) throw new Error("Could not create school admin user.");
  await db.user.update({
    where: { id: signup.user.id },
    data: { orgId: org.id, role: "ADMIN" },
  });

  // Send the invite-with-set-password email through the existing email queue.
  // The school admin clicks the link, sets their own password, and lands on
  // the org's board.
  try {
    await enqueueEmail(context, {
      kind: "school-admin-invite",
      to: input.adminEmail,
      orgName: input.schoolName,
      orgSlug: input.schoolSlug,
      userName: input.adminName,
    } as any);
  } catch (err) {
    console.error("enqueueEmail(school-admin-invite) failed", err);
  }

  await writeDistrictAudit(context, {
    districtId: args.district.id,
    actorUserId: args.actor.id,
    actorEmail: args.actor.email,
    action: "district.school.created",
    targetType: "Org",
    targetId: org.id,
    details: { slug: org.slug, name: org.name },
  });

  const after = computeCapState(beforeCount + 1, args.district.schoolCap);
  if (after.state === "over") {
    await writeDistrictAudit(context, {
      districtId: args.district.id,
      actorUserId: args.actor.id,
      actorEmail: args.actor.email,
      action: "district.school.cap.exceeded",
      targetType: "District",
      targetId: args.district.id,
      details: { count: after.count, cap: after.cap, over: after.over },
    });
  }

  return { org, capExceeded: after.state === "over" };
}
```

If the existing email kind for school admin invites uses a different name in `app/domain/email/queue.server.ts`, use whichever exists. If no match exists, see Task 4.4b below.

- [ ] **Step 4: Verify the email-kind exists or add a stub**

Run: `grep -n '"welcome"\|"school-admin\|"invite"' app/domain/email/queue.server.ts`

If no `school-admin-invite` kind exists, add one:

In `app/domain/email/queue.server.ts`, extend the type union and add the template path. Mirror the structure of the existing `welcome` kind. Reuse the body template if a generic invite already exists.

- [ ] **Step 5: Run unit tests**

Run: `npm test -- --test-name-pattern='validateSchoolProvisioningInput'`
Expected: pass.

- [ ] **Step 6: Create the route**

Create `app/routes/district.schools.new.tsx`:

```tsx
import { redirect } from "react-router";
import type { Route } from "./+types/district.schools.new";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getDistrictById } from "~/domain/district/district.server";
import { provisionSchoolForDistrict } from "~/domain/district/provision-school.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const district = await getDistrictById(context, districtId);
  if (!district) throw new Response("District not found", { status: 404 });
  return { district };
}

export default function NewSchool({ loaderData, actionData }: Route.ComponentProps) {
  const error = (actionData as { error?: string } | undefined)?.error;
  return (
    <section className="max-w-md">
      <h2 className="text-xl font-semibold mb-4">Add a school</h2>
      <p className="text-sm text-gray-600 mb-4">
        We'll create the school's board and email the admin a link to set
        their password.
      </p>
      <form method="post" className="space-y-3">
        <input name="schoolName"  required placeholder="School name"  className="w-full rounded border px-3 py-2" />
        <input name="schoolSlug"  required placeholder="URL slug (e.g. central-elementary)" className="w-full rounded border px-3 py-2" />
        <input name="adminName"   required placeholder="Admin name"   className="w-full rounded border px-3 py-2" />
        <input name="adminEmail"  required type="email" placeholder="Admin email" className="w-full rounded border px-3 py-2" />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button className="rounded bg-black px-4 py-2 text-white">Create school</button>
      </form>
    </section>
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const districtId = requireDistrictAdmin(context);
  const district = await getDistrictById(context, districtId);
  if (!district) throw new Response("District not found", { status: 404 });
  const user = getOptionalUserFromContext(context);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const form = await request.formData();
  try {
    await provisionSchoolForDistrict(context, {
      district,
      actor: { id: user.id, email: (user as { email?: string }).email ?? "" },
      input: {
        schoolName:  String(form.get("schoolName") ?? ""),
        schoolSlug:  String(form.get("schoolSlug") ?? ""),
        adminEmail:  String(form.get("adminEmail") ?? ""),
        adminName:   String(form.get("adminName") ?? ""),
      },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create school." };
  }
  return redirect("/district/schools");
}
```

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add app/routes/district.schools.new.tsx app/domain/district/provision-school.server.ts app/domain/district/provision-school.server.test.ts app/domain/email/queue.server.ts
git commit -m "feat(district): create-school flow with soft-cap audit + admin invite"
```

### Task 4.5: School detail page (district view)

**Files:**
- Create: `app/routes/district.schools.$orgId.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { Form, redirect } from "react-router";
import type { Route } from "./+types/district.schools.$orgId";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getDistrictDb } from "~/domain/district/district-scope.server";

export async function loader({ context, params }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const db = getDistrictDb(context);
  const org = await db.org.findFirst({
    where: { id: params.orgId, districtId }, // explicit district filter
  });
  if (!org) throw new Response("Not found", { status: 404 });
  const [students, families, classrooms, lastCall] = await Promise.all([
    db.student.count({ where: { orgId: org.id } }),
    db.household.count({ where: { orgId: org.id } }),
    db.space.count({ where: { orgId: org.id } }),
    db.callEvent.findFirst({ where: { orgId: org.id }, orderBy: { createdAt: "desc" } }),
  ]);
  return { org, students, families, classrooms, lastCallAt: lastCall?.createdAt ?? null };
}

export default function SchoolDetail({ loaderData }: Route.ComponentProps) {
  const { org, students, families, classrooms, lastCallAt } = loaderData;
  return (
    <section>
      <h2 className="text-xl font-semibold mb-1">{org.name}</h2>
      <p className="text-sm text-gray-500">Slug: {org.slug} · Status: {org.status}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm max-w-md">
        <dt>Students</dt><dd>{students}</dd>
        <dt>Families</dt><dd>{families}</dd>
        <dt>Classrooms</dt><dd>{classrooms}</dd>
        <dt>Last activity</dt><dd>{lastCallAt ? new Date(lastCallAt).toLocaleString() : "—"}</dd>
      </dl>
      <div className="mt-6 flex gap-3">
        <Form method="post" action={`/district/schools/${org.id}/impersonate`}>
          <button className="rounded bg-black px-3 py-1.5 text-sm text-white">Open as admin</button>
        </Form>
        <Form method="post" action={`/district/schools/${org.id}/resend-invite`}>
          <button className="rounded border px-3 py-1.5 text-sm">Re-send admin invite</button>
        </Form>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/routes/district.schools.$orgId.tsx
git commit -m "feat(district): school detail page"
```

### Task 4.6: District admins page (list + invite)

**Files:**
- Create: `app/routes/district.admins.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { redirect } from "react-router";
import type { Route } from "./+types/district.admins";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getPrisma } from "~/db.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { writeDistrictAudit } from "~/domain/district/audit.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const db = getPrisma(context);
  const admins = await db.user.findMany({
    where: { districtId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  return { admins };
}

export default function DistrictAdmins({ loaderData, actionData }: Route.ComponentProps) {
  const { admins } = loaderData;
  const error = (actionData as { error?: string } | undefined)?.error;
  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">District admins</h2>
      <ul className="text-sm divide-y mb-6 max-w-md">
        {admins.map((a) => (
          <li key={a.id} className="py-2 flex justify-between">
            <span>{a.name} <span className="text-gray-500">({a.email})</span></span>
            <span className="text-xs text-gray-400">{new Date(a.createdAt).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
      <form method="post" className="space-y-2 max-w-md">
        <h3 className="font-medium">Invite another admin</h3>
        <input name="name"  required placeholder="Name"  className="w-full rounded border px-3 py-2" />
        <input name="email" required type="email" placeholder="Email" className="w-full rounded border px-3 py-2" />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button className="rounded bg-black px-3 py-1.5 text-sm text-white">Send invite</button>
      </form>
    </section>
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const districtId = requireDistrictAdmin(context);
  const actor = getOptionalUserFromContext(context);
  if (!actor) throw new Response("Unauthorized", { status: 401 });

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!name || !email) return { error: "Name and email are required." };

  const auth = getAuth(context);
  const tempPassword = crypto.randomUUID() + "Aa1!";
  const signup = await auth.api.signUpEmail({ body: { name, email, password: tempPassword } });
  if (!signup?.user?.id) return { error: "Could not create user." };
  const db = getPrisma(context);
  await db.user.update({
    where: { id: signup.user.id },
    data: { districtId, role: "ADMIN" },
  });

  await writeDistrictAudit(context, {
    districtId,
    actorUserId: actor.id,
    actorEmail: (actor as { email?: string }).email ?? null,
    action: "district.admin.invited",
    targetType: "User",
    targetId: signup.user.id,
    details: { invitedEmail: email },
  });

  return redirect("/district/admins");
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/routes/district.admins.tsx
git commit -m "feat(district): admins page with invite flow"
```

---

## Phase 5 — District portal: dashboard

### Task 5.1: Dashboard route with summary, school list, rollup

**Files:**
- Create: `app/routes/district._index.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { Link } from "react-router";
import type { Route } from "./+types/district._index";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getDistrictById, computeCapState } from "~/domain/district/district.server";
import { getSchoolCountsForDistrict, getDistrictRollup } from "~/domain/district/district-scope.server";
import { PLAN_LIMITS, warnThreshold } from "~/lib/plan-limits";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const [district, schools, rollup] = await Promise.all([
    getDistrictById(context, districtId),
    getSchoolCountsForDistrict(context, districtId),
    getDistrictRollup(context, districtId),
  ]);
  if (!district) throw new Response("District not found", { status: 404 });
  return { district, schools, rollup, cap: computeCapState(schools.length, district.schoolCap) };
}

export default function DistrictDashboard({ loaderData }: Route.ComponentProps) {
  const { district, schools, rollup, cap } = loaderData;
  const campusCaps = PLAN_LIMITS.CAMPUS;
  const warnLine = (cap: number) => warnThreshold(cap);
  return (
    <section className="space-y-6">
      {/* Summary card */}
      <div className="rounded border bg-white p-4 flex flex-wrap gap-6">
        <div>
          <h2 className="text-lg font-semibold">{district.name}</h2>
          <p className="text-xs text-gray-500">Plan: {district.billingPlan} · Status: {district.status}</p>
        </div>
        <div>
          <p className="text-sm">{cap.count} of {cap.cap} schools</p>
        </div>
        <Link to="/district/billing" className="ml-auto rounded bg-black px-3 py-1.5 text-sm text-white">
          Manage billing
        </Link>
      </div>

      {cap.state === "over" ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          You're {cap.over} over your contracted school cap. Your account
          manager will be in touch.
        </div>
      ) : null}

      {/* Rollup card */}
      <div className="rounded border bg-white p-4">
        <h3 className="font-medium mb-2">District totals</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div><div className="text-gray-500">Students</div><div className="text-xl">{rollup.totalStudents}</div></div>
          <div><div className="text-gray-500">Families</div><div className="text-xl">{rollup.totalFamilies}</div></div>
          <div><div className="text-gray-500">Classrooms</div><div className="text-xl">{rollup.totalClassrooms}</div></div>
          <div><div className="text-gray-500">Calls (7d)</div><div className="text-xl">{rollup.callsLast7d}</div></div>
          <div><div className="text-gray-500">Calls (30d)</div><div className="text-xl">{rollup.callsLast30d}</div></div>
          <div><div className="text-gray-500">Active schools (30d)</div><div className="text-xl">{rollup.activeSchools}</div></div>
        </div>
      </div>

      {/* School list */}
      <div className="rounded border bg-white p-4">
        <h3 className="font-medium mb-2">Schools</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500">
            <tr><th className="font-normal py-1">School</th><th className="font-normal">Status</th><th className="font-normal">Students</th><th className="font-normal">Families</th><th className="font-normal">Classrooms</th><th className="font-normal">Last activity</th><th></th></tr>
          </thead>
          <tbody>
            {schools.map((s) => {
              const studentsWarn = s.students >= warnLine(campusCaps.students);
              const familiesWarn = s.families >= warnLine(campusCaps.families);
              const classroomsWarn = s.classrooms >= warnLine(campusCaps.classrooms);
              return (
                <tr key={s.id} className="border-t">
                  <td className="py-1.5">{s.name}</td>
                  <td>{s.status}</td>
                  <td className={studentsWarn ? "text-amber-700 font-medium" : ""}>
                    {s.students} / {campusCaps.students}
                  </td>
                  <td className={familiesWarn ? "text-amber-700 font-medium" : ""}>
                    {s.families} / {campusCaps.families}
                  </td>
                  <td className={classroomsWarn ? "text-amber-700 font-medium" : ""}>
                    {s.classrooms} / {campusCaps.classrooms}
                  </td>
                  <td>{s.lastCallAt ? new Date(s.lastCallAt).toLocaleDateString() : "—"}</td>
                  <td><Link to={`/district/schools/${s.id}`} className="underline">Open</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/routes/district._index.tsx
git commit -m "feat(district): dashboard with summary, rollup, and school list"
```

---

## Phase 6 — District portal: billing + impersonation

### Task 6.1: Stripe portal session helper for districts

**Files:**
- Modify: `app/domain/billing/checkout.server.ts` (add a district-targeted helper)
- Create: `app/domain/billing/checkout.server.district.test.ts` (unit test for the helper's input validation)

- [ ] **Step 1: Write a failing test for the district helper signature**

Create `app/domain/billing/checkout.server.district.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertDistrictHasStripeCustomer } from "./checkout.server";

describe("assertDistrictHasStripeCustomer", () => {
  it("throws when stripeCustomerId is null", () => {
    assert.throws(() => assertDistrictHasStripeCustomer({ id: "d1", stripeCustomerId: null } as any), /no Stripe customer/);
  });
  it("does not throw when set", () => {
    assert.doesNotThrow(() => assertDistrictHasStripeCustomer({ id: "d1", stripeCustomerId: "cus_xxx" } as any));
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm test -- --test-name-pattern='assertDistrictHasStripeCustomer'`
Expected: fails (export missing).

- [ ] **Step 3: Add helpers to `checkout.server.ts`**

In `app/domain/billing/checkout.server.ts`, append:

```ts
import type { District } from "~/db";

export function assertDistrictHasStripeCustomer(district: { id: string; stripeCustomerId: string | null }): void {
  if (!district.stripeCustomerId) {
    throw new Error("This district has no Stripe customer attached. Contact your account manager.");
  }
}

export async function createBillingPortalSessionForDistrict(args: {
  context: any;
  district: District;
  returnUrl: string;
}): Promise<{ url: string }> {
  assertDistrictHasStripeCustomer(args.district);
  // Reuse the existing Stripe client and session-creation pattern. If
  // `createBillingPortalSessionForOrg` already wraps `stripe.billingPortal.sessions.create`,
  // extract the inner call into a shared helper and reuse here.
  const stripe = (await import("./stripe.server")).getStripe(args.context);
  const session = await stripe.billingPortal.sessions.create({
    customer: args.district.stripeCustomerId!,
    return_url: args.returnUrl,
  });
  return { url: session.url };
}
```

If `getStripe` is not the actual exported name in `stripe.server.ts`, use whichever helper does exist.

- [ ] **Step 4: Run tests pass**

Run: `npm test -- --test-name-pattern='assertDistrictHasStripeCustomer'`
Expected: pass.

- [ ] **Step 5: Add the test glob**

Verify the new test is matched by `package.json`'s `test` script (it lives in `app/domain/billing/*.test.ts` which is already in the glob).

- [ ] **Step 6: Commit**

```bash
git add app/domain/billing/checkout.server.ts app/domain/billing/checkout.server.district.test.ts
git commit -m "feat(billing): district Stripe billing portal helper"
```

### Task 6.2: District billing route + portal POST

**Files:**
- Create: `app/routes/district.billing.tsx`
- Create: `app/routes/district.billing.portal.tsx`

- [ ] **Step 1: Create the billing page**

```tsx
import { Form } from "react-router";
import type { Route } from "./+types/district.billing";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getDistrictById, getDistrictSchoolCount } from "~/domain/district/district.server";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const [district, schoolCount] = await Promise.all([
    getDistrictById(context, districtId),
    getDistrictSchoolCount(context, districtId),
  ]);
  if (!district) throw new Response("District not found", { status: 404 });
  return { district, schoolCount };
}

export default function DistrictBilling({ loaderData }: Route.ComponentProps) {
  const { district, schoolCount } = loaderData;
  return (
    <section className="max-w-xl">
      <h2 className="text-xl font-semibold mb-2">Billing</h2>
      <dl className="text-sm grid grid-cols-2 gap-y-2 mb-6">
        <dt className="text-gray-500">Plan</dt><dd>{district.billingPlan}</dd>
        <dt className="text-gray-500">Status</dt><dd>{district.status}</dd>
        <dt className="text-gray-500">Schools</dt><dd>{schoolCount} of {district.schoolCap}</dd>
        <dt className="text-gray-500">Trial ends</dt><dd>{district.trialEndsAt ? new Date(district.trialEndsAt).toLocaleDateString() : "Not set"}</dd>
      </dl>
      {district.stripeCustomerId ? (
        <Form method="post" action="/district/billing/portal">
          <button className="rounded bg-black px-4 py-2 text-white">Open Stripe portal</button>
        </Form>
      ) : (
        <p className="text-sm text-gray-600">
          Your account isn't connected to Stripe yet. Your account manager will reach
          out to finalize pricing during your trial.
        </p>
      )}
      <p className="text-xs text-gray-400 mt-6">
        Need to add or remove schools? Contact your account manager.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Create the portal POST route**

Create `app/routes/district.billing.portal.tsx`:

```tsx
import { redirect } from "react-router";
import type { Route } from "./+types/district.billing.portal";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getDistrictById } from "~/domain/district/district.server";
import { createBillingPortalSessionForDistrict } from "~/domain/billing/checkout.server";

export function loader() { return new Response("Method Not Allowed", { status: 405 }); }

export async function action({ request, context }: Route.ActionArgs) {
  const districtId = requireDistrictAdmin(context);
  const district = await getDistrictById(context, districtId);
  if (!district) throw new Response("District not found", { status: 404 });
  const origin = new URL(request.url).origin;
  const { url } = await createBillingPortalSessionForDistrict({
    context,
    district,
    returnUrl: `${origin}/district/billing`,
  });
  return redirect(url);
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add app/routes/district.billing.tsx app/routes/district.billing.portal.tsx
git commit -m "feat(district): billing page + Stripe portal redirect"
```

### Task 6.3: Hide per-org billing UI when `Org.districtId` is set

**Files:**
- Modify: `app/routes/admin/billing.tsx`
- Modify: `app/routes/api/billing.checkout.ts`
- Modify: `app/routes/api/billing.portal.ts`
- Modify: `app/components/Header.tsx` (if it links to billing)

- [ ] **Step 1: Audit per-org billing entry points**

Run: `grep -rn 'href="/admin/billing"\|to="/admin/billing"\|"/api/billing' app --include="*.tsx" --include="*.ts" | head -20`

Expected: lists the routes/components that link or post to per-org billing.

- [ ] **Step 2: Update `app/routes/admin/billing.tsx` loader to redirect district-owned orgs**

In the loader, after resolving the org, add:

```ts
if (org.districtId) {
  // Schools inside a district don't manage their own billing.
  throw redirect("/admin");
}
```

- [ ] **Step 3: Update `api/billing.checkout.ts` and `api/billing.portal.ts`**

In each action, after loading `user`, fetch the org and short-circuit:

```ts
const db = getPrisma(context);
const org = user.orgId ? await db.org.findUnique({ where: { id: user.orgId } }) : null;
if (org?.districtId) {
  return new Response("Billing for this school is managed by your district.", { status: 403 });
}
```

- [ ] **Step 4: Hide the "Billing" nav link in the school admin header**

Open `app/components/Header.tsx` (or wherever the admin nav is rendered). Find the link/button for billing. Wrap it:

```tsx
{org && !org.districtId ? (
  <Link to="/admin/billing">Billing</Link>
) : null}
```

(Adjust to the actual variable holding `org` in that component. If `org` isn't already available there, pull it from `useLoaderData()` of the admin layout, or via `getOptionalOrgFromContext` in the loader.)

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add <touched-files>
git commit -m "feat(district): hide per-school billing UI when org has districtId"
```

### Task 6.4: Impersonation start route

**Files:**
- Create: `app/routes/district.schools.$orgId.impersonate.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { redirect } from "react-router";
import type { Route } from "./+types/district.schools.$orgId.impersonate";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { startImpersonation } from "~/domain/district/impersonation.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { getAuth } from "~/domain/auth/better-auth.server";

export function loader() { return new Response("Method Not Allowed", { status: 405 }); }

export async function action({ request, context, params }: Route.ActionArgs) {
  requireDistrictAdmin(context);
  const user = getOptionalUserFromContext(context);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const auth = getAuth(context);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session?.id) throw new Response("No session", { status: 401 });

  const result = await startImpersonation(context, {
    caller: {
      id: user.id,
      districtId: (user as { districtId?: string | null }).districtId ?? null,
      orgId: user.orgId ?? null,
      isPlatformAdmin: (user as { isPlatformAdmin?: boolean }).isPlatformAdmin === true,
      email: (user as { email?: string }).email ?? null,
    },
    sessionId: session.session.id,
    orgId: params.orgId,
  });

  // Redirect to the impersonated school's admin landing.
  return redirect(`/admin?impersonating=${result.orgSlug}`);
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/routes/district.schools.$orgId.impersonate.tsx
git commit -m "feat(district): impersonation start route"
```

### Task 6.5: Impersonation end route

**Files:**
- Create: `app/routes/district.impersonate.end.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { redirect } from "react-router";
import type { Route } from "./+types/district.impersonate.end";
import { endImpersonation } from "~/domain/district/impersonation.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { getAuth } from "~/domain/auth/better-auth.server";

export function loader() { return new Response("Method Not Allowed", { status: 405 }); }

export async function action({ request, context }: Route.ActionArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  const auth = getAuth(context);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session?.id) throw new Response("No session", { status: 401 });

  await endImpersonation(context, {
    caller: {
      id: user.id,
      districtId: (user as { districtId?: string | null }).districtId ?? null,
      orgId: user.orgId ?? null,
      isPlatformAdmin: (user as { isPlatformAdmin?: boolean }).isPlatformAdmin === true,
      email: (user as { email?: string }).email ?? null,
    },
    sessionId: session.session.id,
  });
  return redirect("/district");
}
```

- [ ] **Step 2: Commit**

```bash
git add app/routes/district.impersonate.end.tsx
git commit -m "feat(district): impersonation end route"
```

### Task 6.6: Impersonation banner component + global mount

**Files:**
- Create: `app/components/ImpersonationBanner.tsx`
- Modify: `app/root.tsx` (mount the banner above all content)

- [ ] **Step 1: Create the banner**

```tsx
import { Form } from "react-router";

type Props = { active: boolean; orgName?: string | null };

export function ImpersonationBanner({ active, orgName }: Props) {
  if (!active) return null;
  return (
    <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 text-sm flex items-center justify-between">
      <span>
        You are impersonating{orgName ? <> as admin of <strong>{orgName}</strong></> : null}.
      </span>
      <Form method="post" action="/district/impersonate/end">
        <button className="rounded border border-amber-400 px-2 py-0.5 text-xs">
          End impersonation
        </button>
      </Form>
    </div>
  );
}
```

- [ ] **Step 2: Mount in root**

Open `app/root.tsx`. Find the loader (it likely sets up user/org on the page). Extend it to expose the impersonation flag + the impersonated org's name.

In the loader:

```ts
import { getImpersonationFromContext } from "~/domain/utils/global-context.server";
import { getOptionalOrgFromContext } from "~/domain/utils/global-context.server";

// inside the existing loader:
const imp = getImpersonationFromContext(context);
const impersonatedOrg = imp.active ? getOptionalOrgFromContext(context) : null;
return { /* ...existing... */, impersonation: { active: imp.active, orgName: impersonatedOrg?.name ?? null } };
```

In the component, render it just inside `<body>`:

```tsx
import { ImpersonationBanner } from "~/components/ImpersonationBanner";
// ...
<ImpersonationBanner active={data.impersonation.active} orgName={data.impersonation.orgName} />
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add app/components/ImpersonationBanner.tsx app/root.tsx
git commit -m "feat(district): impersonation banner mounted globally"
```

---

## Phase 7 — District portal: audit log

### Task 7.1: District audit log route

**Files:**
- Create: `app/routes/district.audit.tsx`

- [ ] **Step 1: Create the route**

```tsx
import type { Route } from "./+types/district.audit";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { listDistrictAudit } from "~/domain/district/audit.server";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const entries = await listDistrictAudit(context, districtId, 200);
  return { entries };
}

export default function DistrictAudit({ loaderData }: Route.ComponentProps) {
  const { entries } = loaderData;
  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">Audit log</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-gray-500">
          <tr><th className="font-normal py-1">When</th><th className="font-normal">Actor</th><th className="font-normal">Action</th><th className="font-normal">Target</th><th className="font-normal">Details</th></tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t">
              <td className="py-1">{new Date(e.createdAt).toLocaleString()}</td>
              <td>{e.actorEmail ?? e.actorUserId ?? "—"}</td>
              <td className="font-mono text-xs">{e.action}</td>
              <td>{e.targetType ?? "—"} {e.targetId ? `· ${e.targetId.slice(0, 8)}` : ""}</td>
              <td className="text-xs text-gray-500">{e.details ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/routes/district.audit.tsx
git commit -m "feat(district): audit log page"
```

---

## Phase 8 — Platform staff panel

### Task 8.1: Districts list in staff panel

**Files:**
- Create: `app/routes/admin.districts._index.tsx`

(Existing platform admin authorization is already enforced via `app/domain/auth/platform-admin.server.ts` — reuse the same guard the existing `/admin/*` routes use; locate it with `grep -n "platformAdmin\|requirePlatformAdmin" app/routes/admin/*.tsx | head`.)

- [ ] **Step 1: Identify the platform-admin guard**

Run: `grep -rn "isPlatformAdmin\|requirePlatformAdmin" app/domain/auth/platform-admin.server.ts app/routes/admin | head`

Expected: locates the function used by other staff routes.

- [ ] **Step 2: Create the route**

```tsx
import { Link } from "react-router";
import type { Route } from "./+types/admin.districts._index";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server"; // adjust to actual export name
import { getPrisma } from "~/db.server";
import { computeCapState } from "~/domain/district/district.server";

export async function loader({ context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context);
  const districts = await db.district.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { orgs: true } } },
  });
  return {
    districts: districts.map((d) => ({
      ...d,
      schoolCount: d._count.orgs,
      capState: computeCapState(d._count.orgs, d.schoolCap),
    })),
  };
}

export default function AdminDistricts({ loaderData }: Route.ComponentProps) {
  const { districts } = loaderData;
  const overCap = districts.filter((d) => d.capState.state === "over");
  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">Districts</h2>
      {overCap.length ? (
        <div className="rounded border border-red-300 bg-red-50 p-3 mb-4 text-sm">
          {overCap.length} district{overCap.length === 1 ? "" : "s"} over their school cap.
        </div>
      ) : null}
      <table className="w-full text-sm">
        <thead className="text-left text-gray-500">
          <tr><th className="font-normal py-1">Name</th><th className="font-normal">Slug</th><th className="font-normal">Schools</th><th className="font-normal">Plan</th><th className="font-normal">Status</th><th className="font-normal">Sub status</th></tr>
        </thead>
        <tbody>
          {districts.map((d) => (
            <tr key={d.id} className={`border-t ${d.capState.state === "over" ? "bg-red-50" : ""}`}>
              <td className="py-1"><Link to={`/admin/districts/${d.slug}`} className="underline">{d.name}</Link></td>
              <td className="font-mono text-xs">{d.slug}</td>
              <td>{d.schoolCount} / {d.schoolCap}</td>
              <td>{d.billingPlan}</td>
              <td>{d.status}</td>
              <td>{d.subscriptionStatus ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add app/routes/admin.districts._index.tsx
git commit -m "feat(staff): districts list with over-cap highlighting"
```

### Task 8.2: District detail (staff edit page)

**Files:**
- Create: `app/routes/admin.districts.$slug.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { Form, redirect } from "react-router";
import type { Route } from "./+types/admin.districts.$slug";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { getDistrictBySlug } from "~/domain/district/district.server";
import { getPrisma } from "~/db.server";
import { writeDistrictAudit, listDistrictAudit } from "~/domain/district/audit.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

export async function loader({ context, params }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const district = await getDistrictBySlug(context, params.slug);
  if (!district) throw new Response("Not found", { status: 404 });
  const audit = await listDistrictAudit(context, district.id, 50);
  return { district, audit };
}

export default function AdminDistrictDetail({ loaderData }: Route.ComponentProps) {
  const { district, audit } = loaderData;
  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">{district.name}</h2>
      <Form method="post" className="rounded border bg-white p-4 space-y-3 max-w-md">
        <h3 className="font-medium">Contract</h3>
        <label className="block text-sm">
          School cap
          <input name="schoolCap" type="number" min={1} defaultValue={district.schoolCap} className="block w-full rounded border px-2 py-1" />
        </label>
        <label className="block text-sm">
          Trial ends at (YYYY-MM-DD)
          <input name="trialEndsAt" type="date" defaultValue={district.trialEndsAt ? new Date(district.trialEndsAt).toISOString().slice(0,10) : ""} className="block w-full rounded border px-2 py-1" />
        </label>
        <label className="block text-sm">
          Stripe customer ID
          <input name="stripeCustomerId" defaultValue={district.stripeCustomerId ?? ""} className="block w-full rounded border px-2 py-1" />
        </label>
        <label className="block text-sm">
          Comp until (YYYY-MM-DD)
          <input name="compedUntil" type="date" defaultValue={district.compedUntil ? new Date(district.compedUntil).toISOString().slice(0,10) : ""} className="block w-full rounded border px-2 py-1" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isComped" defaultChecked={district.isComped} /> Hard-on comp
        </label>
        <label className="block text-sm">
          Billing note
          <textarea name="billingNote" defaultValue={district.billingNote ?? ""} className="block w-full rounded border px-2 py-1" />
        </label>
        <button className="rounded bg-black px-3 py-1.5 text-sm text-white">Save</button>
      </Form>

      <div className="rounded border bg-white p-4">
        <h3 className="font-medium mb-2">Recent audit (50)</h3>
        <ul className="text-xs space-y-1">
          {audit.map((e) => (
            <li key={e.id}><span className="text-gray-500">{new Date(e.createdAt).toISOString()}</span> · {e.action} · {e.actorEmail ?? "—"}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const actor = await requirePlatformAdmin(context); // returns the platform admin user
  const district = await getDistrictBySlug(context, params.slug);
  if (!district) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const db = getPrisma(context);

  const newSchoolCap     = Number(form.get("schoolCap"));
  const newTrialEndsAt   = String(form.get("trialEndsAt") ?? "") ? new Date(String(form.get("trialEndsAt"))) : null;
  const newStripeId      = String(form.get("stripeCustomerId") ?? "").trim() || null;
  const newCompedUntil   = String(form.get("compedUntil") ?? "") ? new Date(String(form.get("compedUntil"))) : null;
  const newIsComped      = form.get("isComped") === "on";
  const newBillingNote   = String(form.get("billingNote") ?? "").trim() || null;

  const updates: Record<string, unknown> = {};
  const audits: Array<{ action: string; details: Record<string, unknown> }> = [];

  if (newSchoolCap !== district.schoolCap) {
    updates.schoolCap = newSchoolCap;
    audits.push({ action: "district.schoolCap.changed", details: { from: district.schoolCap, to: newSchoolCap } });
  }
  if ((newTrialEndsAt?.getTime() ?? null) !== (district.trialEndsAt?.getTime() ?? null)) {
    updates.trialEndsAt = newTrialEndsAt;
    audits.push({ action: "district.trialEndsAt.changed", details: { from: district.trialEndsAt, to: newTrialEndsAt } });
  }
  if (newStripeId !== district.stripeCustomerId) updates.stripeCustomerId = newStripeId;
  if ((newCompedUntil?.getTime() ?? null) !== (district.compedUntil?.getTime() ?? null) || newIsComped !== district.isComped) {
    updates.compedUntil = newCompedUntil;
    updates.isComped = newIsComped;
    audits.push({ action: "district.comp.changed", details: { compedUntil: newCompedUntil, isComped: newIsComped } });
  }
  if (newBillingNote !== district.billingNote) {
    updates.billingNote = newBillingNote;
    audits.push({ action: "district.billing.note.changed", details: {} });
  }

  if (Object.keys(updates).length > 0) {
    await db.district.update({ where: { id: district.id }, data: updates });
  }
  for (const a of audits) {
    await writeDistrictAudit(context, {
      districtId: district.id,
      actorUserId: actor.id,
      actorEmail: (actor as { email?: string }).email ?? null,
      action: a.action as any,
      details: a.details,
    });
  }
  return redirect(`/admin/districts/${district.slug}`);
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/routes/admin.districts.$slug.tsx
git commit -m "feat(staff): district detail page with editable contract levers"
```

### Task 8.3: `reparentOrgToDistrict` admin script + runbook

**Files:**
- Create: `scripts/reparent-org-to-district.ts`
- Create: `docs/runbooks/reparent-org-to-district.md`

- [ ] **Step 1: Create the script**

Create `scripts/reparent-org-to-district.ts`:

```ts
/**
 * Move an existing standalone Org under a District. Manual operation —
 * platform staff only. Run via:
 *
 *   npx tsx scripts/reparent-org-to-district.ts <orgId> <districtId>
 *
 * Effects:
 *   - Sets Org.districtId = districtId.
 *   - Cancels the Org's own Stripe subscription if one exists (caller's
 *     responsibility — this script does NOT touch Stripe; do that manually
 *     before running).
 *   - Writes a DistrictAuditLog entry.
 */
import { PrismaClient } from "../app/db/generated/client";

async function main() {
  const [orgId, districtId] = process.argv.slice(2);
  if (!orgId || !districtId) {
    console.error("usage: reparent-org-to-district <orgId> <districtId>");
    process.exit(1);
  }
  const db = new PrismaClient(); // direct connection; assumes a configured DATABASE_URL or D1 binding

  const org = await db.org.findUnique({ where: { id: orgId } });
  if (!org) throw new Error(`Org ${orgId} not found.`);
  const district = await db.district.findUnique({ where: { id: districtId } });
  if (!district) throw new Error(`District ${districtId} not found.`);

  await db.$transaction([
    db.org.update({ where: { id: orgId }, data: { districtId } }),
    db.districtAuditLog.create({
      data: {
        districtId,
        action: "district.school.created", // reusing — this is a reparent, log as a school join
        targetType: "Org",
        targetId: orgId,
        details: JSON.stringify({ reparentedFromStandalone: true, slug: org.slug }),
      },
    }),
  ]);
  console.log(`Reparented ${org.slug} -> district ${district.slug}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

(Note: D1 doesn't support direct PrismaClient construction outside the Worker. If running against staging/prod is required, this script needs to be invoked through `wrangler d1 execute` with a hand-written SQL UPDATE. Add that note in the runbook.)

- [ ] **Step 2: Create the runbook**

Create `docs/runbooks/reparent-org-to-district.md`:

```markdown
# Reparent a standalone org under a district

Use when sales has signed a district contract that includes a customer who
already has a standalone Pickup Roster account.

## Pre-flight

1. Confirm the Org's per-school Stripe subscription is canceled (or will be
   credited). District billing replaces it.
2. Confirm the District has a Stripe customer attached (`stripeCustomerId` set).

## Local / staging

```bash
npx tsx scripts/reparent-org-to-district.ts <orgId> <districtId>
```

## Production (D1)

D1 doesn't expose a PrismaClient outside the Worker; use raw SQL:

```bash
npx wrangler d1 execute pickup-roster-prod --remote \
  --command "UPDATE \"Org\" SET \"districtId\" = '<districtId>' WHERE id = '<orgId>'"
npx wrangler d1 execute pickup-roster-prod --remote \
  --command "INSERT INTO \"DistrictAuditLog\" (id, districtId, action, targetType, targetId, details, createdAt) VALUES ('<cuid>', '<districtId>', 'district.school.created', 'Org', '<orgId>', '{\"reparentedFromStandalone\":true}', CURRENT_TIMESTAMP)"
```

Generate a `cuid` ahead of time (any cuid-compatible string).

## Post-flight

1. Visit the staff panel district detail page; confirm the org appears in
   the school list and audit log.
2. Notify the school admin that billing has moved.
```

- [ ] **Step 3: Commit**

```bash
git add scripts/reparent-org-to-district.ts docs/runbooks/reparent-org-to-district.md
git commit -m "feat(staff): reparent-org-to-district script and runbook"
```

---

## Phase 9 — E2E + final polish

### Task 9.1: E2E test for full district flow

**Files:**
- Create: `e2e/flows/district.spec.ts`
- Create: `e2e/fixtures/district-fixtures.ts`

- [ ] **Step 1: Inspect existing E2E fixture conventions**

Run: `head -80 e2e/fixtures/seeded-tenant.ts`
Expected: shows the existing fixture pattern (Playwright `test.extend`).

- [ ] **Step 2: Create district seed helper**

Create `e2e/fixtures/district-fixtures.ts`:

```ts
import { test as base, expect, type Page } from "@playwright/test";

export type DistrictSession = {
  district: { id: string; slug: string; name: string };
  admin: { email: string; password: string };
};

/**
 * Provisions a fresh district with one admin via the public signup flow.
 * Each test gets isolated data — names use `Date.now()` to avoid slug
 * collisions across parallel runs.
 */
export const test = base.extend<{ district: DistrictSession; districtPage: Page }>({
  district: async ({}, use) => {
    const stamp = Date.now();
    const session: DistrictSession = {
      district: { id: "", slug: `dist-${stamp}`, name: `Test District ${stamp}` },
      admin: { email: `admin-${stamp}@example.test`, password: "Pa$$w0rd1234!" },
    };
    await use(session);
  },
  districtPage: async ({ page, district }, use) => {
    await page.goto("/district/signup");
    await page.fill("[name=districtName]", district.district.name);
    await page.fill("[name=adminName]", "Test Admin");
    await page.fill("[name=adminEmail]", district.admin.email);
    await page.fill("[name=adminPassword]", district.admin.password);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/district$/);
    await use(page);
  },
});

export { expect };
```

- [ ] **Step 3: Create the E2E spec**

Create `e2e/flows/district.spec.ts`:

```ts
import { test, expect } from "../fixtures/district-fixtures";

test.describe("district portal", () => {
  test("signup → create school → invite admin lands on dashboard", async ({ districtPage }) => {
    await expect(districtPage.getByRole("heading", { name: /Schools/ })).toBeVisible();
    // Create a school
    await districtPage.click("text=Add school");
    await districtPage.fill("[name=schoolName]", "Central Elementary");
    await districtPage.fill("[name=schoolSlug]", `central-${Date.now()}`);
    await districtPage.fill("[name=adminName]", "School Admin");
    await districtPage.fill("[name=adminEmail]", `school-${Date.now()}@example.test`);
    await districtPage.click("button:has-text('Create school')");
    await expect(districtPage).toHaveURL(/\/district\/schools$/);
    await expect(districtPage.locator("td", { hasText: "Central Elementary" })).toBeVisible();
  });

  test("soft cap exceeded shows banner", async ({ districtPage }) => {
    // Default cap is 3. Create 4 schools.
    for (let i = 0; i < 4; i++) {
      await districtPage.goto("/district/schools/new");
      await districtPage.fill("[name=schoolName]", `School ${i}`);
      await districtPage.fill("[name=schoolSlug]", `cap-${Date.now()}-${i}`);
      await districtPage.fill("[name=adminName]", `Admin ${i}`);
      await districtPage.fill("[name=adminEmail]", `cap-${Date.now()}-${i}@example.test`);
      await districtPage.click("button:has-text('Create school')");
      await expect(districtPage).toHaveURL(/\/district\/schools$/);
    }
    await expect(districtPage.getByText(/over your contracted school cap/)).toBeVisible();
  });

  test("impersonation roundtrip writes audit log", async ({ districtPage }) => {
    // Create a school to impersonate into.
    const slug = `imp-${Date.now()}`;
    await districtPage.goto("/district/schools/new");
    await districtPage.fill("[name=schoolName]", "Imp School");
    await districtPage.fill("[name=schoolSlug]", slug);
    await districtPage.fill("[name=adminName]", "Imp Admin");
    await districtPage.fill("[name=adminEmail]", `imp-${Date.now()}@example.test`);
    await districtPage.click("button:has-text('Create school')");
    await expect(districtPage).toHaveURL(/\/district\/schools$/);

    // Open the school detail and impersonate.
    await districtPage.click(`a:has-text('Open')`);
    await districtPage.click("button:has-text('Open as admin')");
    // Expect impersonation banner.
    await expect(districtPage.getByText(/You are impersonating/)).toBeVisible();

    // End.
    await districtPage.click("button:has-text('End impersonation')");
    await expect(districtPage).toHaveURL(/\/district$/);

    // Audit log shows both events.
    await districtPage.goto("/district/audit");
    await expect(districtPage.locator("td", { hasText: "district.impersonate.start" })).toBeVisible();
    await expect(districtPage.locator("td", { hasText: "district.impersonate.end" })).toBeVisible();
  });
});
```

- [ ] **Step 4: Run E2E (heads-up: disk-heavy — see global rules)**

Run: `npm run test:e2e -- e2e/flows/district.spec.ts`
Expected: all three tests pass.

- [ ] **Step 5: Run cleanup**

Run: `npm run clean:e2e && npm run clean:tmp`

- [ ] **Step 6: Commit**

```bash
git add e2e/flows/district.spec.ts e2e/fixtures/district-fixtures.ts
git commit -m "test(district): E2E for signup, soft cap, and impersonation"
```

### Task 9.2: Cross-district isolation integration test

**Files:**
- Create: `app/domain/district/cross-isolation.test.ts`

This is a unit-style test that uses the in-memory Prisma D1 adapter (or a sqlite test DB via `:memory:`) to assert that `district-scope.server.ts` queries can't leak across districts.

- [ ] **Step 1: Inspect existing DB-backed test setup**

Run: `grep -rn "PrismaClient\|new Prisma" app/domain --include="*.test.ts" | head`

Expected: shows whether an existing test uses an in-memory client or seeds against the real D1 binding via `wrangler dev`.

- [ ] **Step 2: Write the test**

If existing tests construct an in-memory Prisma client, follow that pattern. Otherwise, use `better-sqlite3` directly via the `@prisma/adapter-better-sqlite3` package or skip this test in favor of E2E coverage.

A skeleton (adjust to actual harness):

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
// import { createTestPrisma } from "../../test-helpers/prisma"; // existing helper if any

describe("cross-district isolation", () => {
  // ... seed: 2 districts, 1 org per district, 1 student per org
  it("listSchoolsForDistrict only returns own district's orgs", async () => {
    // const result = await listSchoolsForDistrict(ctx, districtA.id);
    // assert.equal(result.length, 1);
    // assert.equal(result[0].id, orgA.id);
  });
  it("getDistrictRollup totals don't leak from sibling district", async () => {
    // ...
  });
});
```

If no test-DB harness exists yet, **skip this task** and instead document the gap as a v1.5 follow-up. The E2E test from Task 9.1 covers the user-visible path; pure isolation testing without harness setup is out of scope for this plan.

- [ ] **Step 3: Commit (or skip with a note in the spec)**

If implemented:
```bash
git add app/domain/district/cross-isolation.test.ts
git commit -m "test(district): cross-district aggregate isolation"
```

If skipped, append a note to the spec's Section 14:

```bash
# edit docs/superpowers/specs/2026-04-25-district-multi-tenancy-design.md
# add to "Open considerations":
#   - DB-harness-backed cross-district isolation unit tests (covered by E2E for now)
git add docs/superpowers/specs/2026-04-25-district-multi-tenancy-design.md
git commit -m "docs(district): note isolation unit test deferred to v1.5"
```

### Task 9.3: Marketing pricing page note

**Files:**
- Modify: `app/routes/pricing.tsx`

- [ ] **Step 1: Locate the pricing page section**

Run: `grep -n "DISTRICT\|district\|trial\|hardship" app/routes/pricing.tsx | head`

Expected: shows the existing plan tiers and where to add a note.

- [ ] **Step 2: Add the hardship support note**

Add a small section near the bottom of the pricing page (or under the FAQ if there is one):

```tsx
<aside className="mt-12 rounded border border-blue-200 bg-blue-50 p-4 text-sm">
  <h3 className="font-medium mb-1">Mid-year sign-ups & small private schools</h3>
  <p>
    Joining mid-school-year, or running a small private school where the
    listed pricing isn't workable? Mention it during your free trial — our
    team will work with you on pricing.
  </p>
</aside>
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add app/routes/pricing.tsx
git commit -m "docs(marketing): hardship-support note on pricing page"
```

---

## Final verification

- [ ] **Run the full unit suite**

Run: `npm test`
Expected: all pass.

- [ ] **Run the full type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Run linter if one exists**

Run: `npm run lint 2>/dev/null || echo 'no lint script'`

- [ ] **Run district E2E**

Run: `npm run test:e2e -- e2e/flows/district.spec.ts`
Expected: pass.

- [ ] **Cleanup**

Run: `npm run clean:e2e && npm run clean:tmp`

- [ ] **Verify the staff panel link to districts is reachable**

Open the dev server, log in as a platform admin, navigate to `/admin/districts`. Confirm the page loads and shows the districts seeded by the E2E run (or "no districts" if the test DB was wiped).

- [ ] **Final commit if any cleanup happened**

```bash
git status
# only commit if there are intentional changes
```

---

## Out of scope (per spec, deferred to v1.5+)

- District custom domain + theme overrides
- Self-serve "request more schools" flow with sales-quote integration
- Stripe overage automation
- Read-only drill-down for district admins (alternative to impersonation)
- Memberships table for users with both district + school roles
- Per-student aggregate metering with pooled caps
- DB-harness-backed cross-district isolation unit tests (E2E covers user-visible path for v1)
