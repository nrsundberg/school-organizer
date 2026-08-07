# Roster Importer Household Dedup + Merge UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the roster importer from creating duplicate households for siblings who share a pickup space, and give staff a banner + view to find and merge the duplicates already in the database.

**Architecture:** The importer fix pre-resolves households for every referenced space *sequentially* before the parallel student-creation step, eliminating the race that produced duplicates. Duplicate detection and merge logic live in a focused, prisma-agnostic server module (`app/domain/households/merge.server.ts`) unit-tested with structural fakes. A new admin route (`/admin/households/duplicates`) renders groups and runs the merge; the households list shows an SSR-safe, localStorage-snoozable banner linking to it.

**Tech Stack:** React Router 7, Cloudflare Workers, Prisma + D1 (SQLite), better-auth, `node:test` via `tsx --test`, remix-toast.

**Spec:** `docs/superpowers/specs/2026-06-15-roster-importer-household-dedup-design.md`

---

## File Structure

- **Modify** `app/domain/csv/roster-import.server.ts` — pre-resolve households sequentially in `applyRosterImport` (the race fix).
- **Create** `app/domain/csv/roster-import.server.test.ts` — regression test for the race fix (picked up by `npm test`'s `app/domain/csv/*.test.ts` glob).
- **Create** `app/domain/households/merge.server.ts` — `groupDuplicateHouseholds` (detection) + `mergeHouseholdGroup` (merge), both prisma-agnostic via structural types.
- **Create** `app/domain/households/merge.server.test.ts` — unit tests (picked up by `app/domain/households/*.test.ts` glob).
- **Create** `app/routes/admin/households.duplicates.tsx` — the merge view (loader + action + UI).
- **Modify** `app/routes.ts` — register the new route BEFORE the `households/:householdId` param route.
- **Create** `app/components/admin/DuplicateHouseholdsBanner.tsx` — SSR-safe, localStorage-snoozed banner.
- **Modify** `app/routes/admin/households.tsx` — compute `duplicateSpaceCount` in the loader; render the banner.

Notes on D1 constraints:
- D1/Prisma here does **not** use interactive `$transaction` (see `applyRosterImport`, which uses sequential awaits). The merge orders operations defensively: reassign children + exceptions FIRST, delete losing households LAST. This matters because `Student.householdId` is `onDelete: SetNull` and `DismissalException.householdId` is `onDelete: Cascade` — deleting first would null/destroy the rows we need to move.

---

## Task 1: Importer race fix

**Files:**
- Test: `app/domain/csv/roster-import.server.test.ts` (create)
- Modify: `app/domain/csv/roster-import.server.ts:629-667`

- [ ] **Step 1: Write the failing regression test**

Create `app/domain/csv/roster-import.server.test.ts`:

```ts
/**
 * Regression test: siblings sharing a pickup space must land in ONE household.
 * The original importer created households inside a `Promise.all` chunk, so
 * concurrent getOrCreateHousehold calls each saw "no household yet" and each
 * created a duplicate. This test reproduces that interleaving with a fake
 * prisma whose findFirst/create resolve on a microtask.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { applyRosterImport, type RosterImportRow, type RosterPrisma } from "./roster-import.server";

type ExistingSnapshot = {
  students?: {
    id: number;
    firstName: string;
    lastName: string;
    homeRoom: string | null;
    household: { spaceNumber: number | null } | null;
  }[];
  teachers?: { homeRoom: string }[];
  spaces?: { spaceNumber: number }[];
};

function makeFakePrisma(existing: ExistingSnapshot = {}) {
  const committed = new Map<number, string>(); // spaceNumber -> household id
  let hCounter = 0;
  const createdHouseholds: { spaceNumber: number; name: string; id: string }[] = [];
  const createdStudents: {
    firstName: string;
    lastName: string;
    homeRoom: string | null;
    householdId: string | null;
  }[] = [];

  const prisma: RosterPrisma = {
    student: {
      findMany: async () => existing.students ?? [],
      createMany: async ({ data }) => {
        createdStudents.push(...data);
        return {};
      },
      update: async () => ({}),
    },
    teacher: {
      findMany: async () => existing.teachers ?? [],
      create: async () => ({}),
    },
    space: {
      findMany: async () => existing.spaces ?? [],
      create: async () => ({}),
    },
    household: {
      findFirst: async ({ where }) => {
        await Promise.resolve(); // force interleaving
        const id = committed.get(where.spaceNumber);
        return id ? { id } : null;
      },
      create: async ({ data }) => {
        await Promise.resolve();
        const id = `h${++hCounter}`;
        committed.set(data.spaceNumber, id);
        createdHouseholds.push({ ...data, id });
        return { id };
      },
    },
  };

  return { prisma, createdHouseholds, createdStudents };
}

function row(rowNumber: number, firstName: string, lastName: string, spaceNumber: number | null): RosterImportRow {
  return { rowNumber, firstName, lastName, homeRoom: `Room ${spaceNumber ?? "X"}`, spaceNumber };
}

test("applyRosterImport: siblings on one space share a single household", async () => {
  const { prisma, createdHouseholds, createdStudents } = makeFakePrisma();
  const rows: RosterImportRow[] = [
    row(2, "Ada", "Lovelace", 12),
    row(3, "Bob", "Lovelace", 12),
    row(4, "Cy", "Lovelace", 12),
  ];

  const result = await applyRosterImport(prisma, rows);

  assert.equal(result.ok, true);
  assert.equal(createdHouseholds.length, 1, "exactly one household for space 12");
  const ids = new Set(createdStudents.map((s) => s.householdId));
  assert.equal(ids.size, 1, "all three students share one householdId");
  assert.equal([...ids][0], createdHouseholds[0].id);
});

test("applyRosterImport: different last names on one space still share a household", async () => {
  const { prisma, createdHouseholds } = makeFakePrisma();
  const rows: RosterImportRow[] = [
    row(2, "Ada", "Lovelace", 12),
    row(3, "Bob", "Hopper", 12),
  ];

  const result = await applyRosterImport(prisma, rows);

  assert.equal(result.ok, true);
  assert.equal(createdHouseholds.length, 1, "space-only dedup: one household");
});

test("applyRosterImport: null space yields null householdId", async () => {
  const { prisma, createdHouseholds, createdStudents } = makeFakePrisma();
  const result = await applyRosterImport(prisma, [row(2, "Ada", "Lovelace", null)]);

  assert.equal(result.ok, true);
  assert.equal(createdHouseholds.length, 0);
  assert.equal(createdStudents[0].householdId, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- 2>&1 | grep -A3 "siblings on one space"`

Or run the file directly:
Run: `npx tsx --test app/domain/csv/roster-import.server.test.ts`
Expected: FAIL — `createdHouseholds.length` is `3`, not `1` (the race creates one household per sibling).

- [ ] **Step 3: Implement the fix**

In `app/domain/csv/roster-import.server.ts`, find the block that starts at `const newRows = plan.rows.filter((row) => row.status === "new");` (around line 651). Insert the pre-resolution loop immediately **after** the `getOrCreateHousehold` definition (after its closing `}` around line 649) and **before** `const newRows = ...`:

```ts
  // Pre-resolve a household for every unique non-null space number referenced
  // by this import, SEQUENTIALLY, before the parallel student-creation step
  // below. Siblings sharing a space must share one household; resolving
  // sequentially guarantees the first row for a space creates the household
  // and every later row reads it from `householdCache`. Without this, the
  // `Promise.all` chunk below ran every sibling's getOrCreateHousehold
  // concurrently — they all saw "no household yet" and each created a duplicate.
  const spacesInImport = new Set<number>();
  for (const r of plan.rows) {
    if ((r.status === "new" || r.status === "update") && r.spaceNumber != null) {
      spacesInImport.add(r.spaceNumber);
    }
  }
  for (const spaceNumber of spacesInImport) {
    const familyName =
      plan.rows.find((r) => r.spaceNumber === spaceNumber)?.lastName ?? "";
    await getOrCreateHousehold(spaceNumber, familyName);
  }
```

The existing `newRows` chunk loop and the `update` loop are unchanged — their `getOrCreateHousehold` calls now hit the populated cache and return synchronously (the `if (cached !== undefined) return cached;` early-return), so no `findFirst`/`create` runs concurrently.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test app/domain/csv/roster-import.server.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/domain/csv/roster-import.server.ts app/domain/csv/roster-import.server.test.ts
git commit -m "fix(roster-import): pre-resolve households sequentially to stop sibling dupes"
```

---

## Task 2: Duplicate detection helper

**Files:**
- Create: `app/domain/households/merge.server.ts`
- Test: `app/domain/households/merge.server.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `app/domain/households/merge.server.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { groupDuplicateHouseholds, type HouseholdLite } from "./merge.server";

function h(id: string, spaceNumber: number | null, createdAt: string): HouseholdLite {
  return { id, spaceNumber, createdAt: new Date(createdAt) };
}

test("groupDuplicateHouseholds: groups non-null spaces with >1 member", () => {
  const groups = groupDuplicateHouseholds([
    h("a", 12, "2026-01-01"),
    h("b", 12, "2026-01-02"),
    h("c", 13, "2026-01-01"), // singleton, excluded
    h("d", null, "2026-01-01"), // null space, excluded
    h("e", null, "2026-01-02"), // null space, excluded (nulls never group)
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((x) => x.id), ["a", "b"]);
});

test("groupDuplicateHouseholds: each group is ordered oldest-first (survivor first)", () => {
  const groups = groupDuplicateHouseholds([
    h("late", 5, "2026-03-01"),
    h("early", 5, "2026-01-01"),
    h("mid", 5, "2026-02-01"),
  ]);

  assert.deepEqual(groups[0].map((x) => x.id), ["early", "mid", "late"]);
});

test("groupDuplicateHouseholds: empty input -> no groups", () => {
  assert.deepEqual(groupDuplicateHouseholds([]), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test app/domain/households/merge.server.test.ts`
Expected: FAIL — `Cannot find module './merge.server'` / export missing.

- [ ] **Step 3: Implement `groupDuplicateHouseholds`**

Create `app/domain/households/merge.server.ts`:

```ts
/**
 * Household duplicate detection + merge.
 *
 * Identity for dedup is the pickup `spaceNumber` ONLY (per the roster-import
 * design): every student on a space belongs to one household. Households with a
 * null space are never considered duplicates of each other.
 *
 * These functions are prisma-agnostic (structural types) so they unit-test
 * against simple fakes — see merge.server.test.ts.
 */

export type HouseholdLite = {
  id: string;
  spaceNumber: number | null;
  createdAt: Date;
};

/**
 * Group households that share a non-null space and have more than one member.
 * Each returned group is ordered oldest-first (by createdAt, then id) so the
 * caller can treat the first element as the default survivor.
 */
export function groupDuplicateHouseholds<T extends HouseholdLite>(households: T[]): T[][] {
  const bySpace = new Map<number, T[]>();
  for (const h of households) {
    if (h.spaceNumber == null) continue;
    const arr = bySpace.get(h.spaceNumber) ?? [];
    arr.push(h);
    bySpace.set(h.spaceNumber, arr);
  }
  return [...bySpace.values()]
    .filter((group) => group.length > 1)
    .map((group) =>
      [...group].sort((a, b) => {
        const t = a.createdAt.getTime() - b.createdAt.getTime();
        return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }),
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test app/domain/households/merge.server.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/domain/households/merge.server.ts app/domain/households/merge.server.test.ts
git commit -m "feat(households): add duplicate household detection helper"
```

---

## Task 3: Merge operation

**Files:**
- Modify: `app/domain/households/merge.server.ts`
- Test: `app/domain/households/merge.server.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/domain/households/merge.server.test.ts`:

```ts
import { mergeHouseholdGroup, type MergePrisma, type MergeHouseholdGroupInput } from "./merge.server";

function makeMergeFake() {
  const calls: string[] = [];
  const studentReassigned: { from: string; to: string }[] = [];
  const exceptionReassigned: { from: string; to: string }[] = [];
  let survivorUpdate: { id: string; data: unknown } | null = null;
  let deleted: string[] = [];

  const prisma: MergePrisma = {
    student: {
      updateMany: async ({ where, data }) => {
        calls.push("student.updateMany");
        studentReassigned.push({ from: where.householdId, to: data.householdId });
        return {};
      },
    },
    dismissalException: {
      updateMany: async ({ where, data }) => {
        calls.push("dismissalException.updateMany");
        exceptionReassigned.push({ from: where.householdId, to: data.householdId });
        return {};
      },
    },
    household: {
      update: async ({ where, data }) => {
        calls.push("household.update");
        survivorUpdate = { id: where.id, data };
        return {};
      },
      deleteMany: async ({ where }) => {
        calls.push("household.deleteMany");
        deleted = where.id.in;
        return {};
      },
    },
  };

  return {
    prisma,
    get calls() {
      return calls;
    },
    get studentReassigned() {
      return studentReassigned;
    },
    get exceptionReassigned() {
      return exceptionReassigned;
    },
    get survivorUpdate() {
      return survivorUpdate;
    },
    get deleted() {
      return deleted;
    },
  };
}

const baseInput: MergeHouseholdGroupInput = {
  survivorId: "survivor",
  losingIds: ["lose1", "lose2"],
  scalars: {
    name: "Lovelace",
    pickupNotes: "side gate",
    primaryContactName: "Ada",
    primaryContactPhone: "555-0100",
  },
};

test("mergeHouseholdGroup: reassigns students + exceptions from each loser to survivor", async () => {
  const fake = makeMergeFake();
  await mergeHouseholdGroup(fake.prisma, baseInput);

  assert.deepEqual(fake.studentReassigned, [
    { from: "lose1", to: "survivor" },
    { from: "lose2", to: "survivor" },
  ]);
  assert.deepEqual(fake.exceptionReassigned, [
    { from: "lose1", to: "survivor" },
    { from: "lose2", to: "survivor" },
  ]);
});

test("mergeHouseholdGroup: writes chosen scalars to survivor and deletes losers", async () => {
  const fake = makeMergeFake();
  await mergeHouseholdGroup(fake.prisma, baseInput);

  assert.deepEqual(fake.survivorUpdate, { id: "survivor", data: baseInput.scalars });
  assert.deepEqual(fake.deleted, ["lose1", "lose2"]);
});

test("mergeHouseholdGroup: deletes losers only AFTER reassigning their rows", async () => {
  const fake = makeMergeFake();
  await mergeHouseholdGroup(fake.prisma, baseInput);

  const lastReassign = Math.max(
    fake.calls.lastIndexOf("student.updateMany"),
    fake.calls.lastIndexOf("dismissalException.updateMany"),
  );
  const deleteIdx = fake.calls.indexOf("household.deleteMany");
  assert.ok(deleteIdx > lastReassign, "deleteMany must run after all reassignments");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test app/domain/households/merge.server.test.ts`
Expected: FAIL — `mergeHouseholdGroup` / `MergePrisma` not exported.

- [ ] **Step 3: Implement `mergeHouseholdGroup`**

Append to `app/domain/households/merge.server.ts`:

```ts
export type HouseholdScalars = {
  name: string;
  pickupNotes: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
};

export type MergeHouseholdGroupInput = {
  survivorId: string;
  losingIds: string[];
  scalars: HouseholdScalars;
};

/** Structural slice of Prisma used by the merge. */
export type MergePrisma = {
  student: {
    updateMany: (args: {
      where: { householdId: string };
      data: { householdId: string };
    }) => Promise<unknown>;
  };
  dismissalException: {
    updateMany: (args: {
      where: { householdId: string };
      data: { householdId: string };
    }) => Promise<unknown>;
  };
  household: {
    update: (args: { where: { id: string }; data: HouseholdScalars }) => Promise<unknown>;
    deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<unknown>;
  };
};

/**
 * Merge duplicate households into one survivor.
 *
 * Order matters and is intentional: D1 has no interactive transactions here, so
 * we reassign every loser's students and dismissal exceptions to the survivor
 * FIRST, then delete the losers LAST. Deleting first would trip the schema's
 * `onDelete` rules (Student.householdId -> SetNull, DismissalException -> Cascade)
 * and lose the very rows we mean to move.
 */
export async function mergeHouseholdGroup(
  prisma: MergePrisma,
  input: MergeHouseholdGroupInput,
): Promise<void> {
  for (const losingId of input.losingIds) {
    await prisma.student.updateMany({
      where: { householdId: losingId },
      data: { householdId: input.survivorId },
    });
    await prisma.dismissalException.updateMany({
      where: { householdId: losingId },
      data: { householdId: input.survivorId },
    });
  }
  await prisma.household.update({
    where: { id: input.survivorId },
    data: input.scalars,
  });
  await prisma.household.deleteMany({
    where: { id: { in: input.losingIds } },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test app/domain/households/merge.server.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add app/domain/households/merge.server.ts app/domain/households/merge.server.test.ts
git commit -m "feat(households): add mergeHouseholdGroup operation"
```

---

## Task 4: Merge view route

**Files:**
- Create: `app/routes/admin/households.duplicates.tsx`
- Modify: `app/routes.ts:14-16`

- [ ] **Step 1: Register the route**

In `app/routes.ts`, inside the `route("admin", "routes/admin/layout.tsx", [ ... ])` array, add the duplicates route **before** the `households/:householdId` param route so the literal segment isn't swallowed by the dynamic one. Change:

```ts
    route("households", "routes/admin/households.tsx"),
    route("households/:householdId", "routes/admin/households.$householdId.tsx"),
```

to:

```ts
    route("households", "routes/admin/households.tsx"),
    route("households/duplicates", "routes/admin/households.duplicates.tsx"),
    route("households/:householdId", "routes/admin/households.$householdId.tsx"),
```

- [ ] **Step 2: Create the route file**

Create `app/routes/admin/households.duplicates.tsx`:

```tsx
import { Form, Link, redirect } from "react-router";
import { ArrowLeft } from "lucide-react";
import { redirectWithSuccess, redirectWithError } from "remix-toast";
import type { Route } from "./+types/households.duplicates";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import {
  groupDuplicateHouseholds,
  mergeHouseholdGroup,
  type HouseholdScalars,
} from "~/domain/households/merge.server";

type GroupHousehold = {
  id: string;
  name: string;
  spaceNumber: number;
  pickupNotes: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  createdAt: Date;
  students: { id: number; firstName: string; lastName: string }[];
};

type DuplicateGroup = {
  spaceNumber: number;
  households: GroupHousehold[];
};

export async function loader({ context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);

  const households = await prisma.household.findMany({
    where: { spaceNumber: { not: null } },
    select: {
      id: true,
      name: true,
      spaceNumber: true,
      pickupNotes: true,
      primaryContactName: true,
      primaryContactPhone: true,
      createdAt: true,
    },
  });

  const groups = groupDuplicateHouseholds(
    households.map((h) => ({ id: h.id, spaceNumber: h.spaceNumber, createdAt: h.createdAt })),
  );

  const involvedIds = groups.flat().map((h) => h.id);
  const students = involvedIds.length
    ? await prisma.student.findMany({
        where: { householdId: { in: involvedIds } },
        select: { id: true, firstName: true, lastName: true, householdId: true },
        orderBy: { lastName: "asc" },
      })
    : [];

  const studentsByHousehold = new Map<string, { id: number; firstName: string; lastName: string }[]>();
  for (const s of students) {
    if (!s.householdId) continue;
    const arr = studentsByHousehold.get(s.householdId) ?? [];
    arr.push({ id: s.id, firstName: s.firstName, lastName: s.lastName });
    studentsByHousehold.set(s.householdId, arr);
  }

  const byId = new Map(households.map((h) => [h.id, h]));
  const duplicateGroups: DuplicateGroup[] = groups.map((group) => ({
    spaceNumber: group[0].spaceNumber as number,
    households: group.map((g) => {
      const full = byId.get(g.id)!;
      return {
        id: full.id,
        name: full.name,
        spaceNumber: full.spaceNumber as number,
        pickupNotes: full.pickupNotes,
        primaryContactName: full.primaryContactName,
        primaryContactPhone: full.primaryContactPhone,
        createdAt: full.createdAt,
        students: studentsByHousehold.get(full.id) ?? [],
      };
    }),
  }));

  return { duplicateGroups };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const form = await request.formData();

  const survivorId = String(form.get("survivorId") ?? "");
  const losingIds = String(form.get("losingIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!survivorId || losingIds.length === 0) {
    return redirectWithError("/admin/households/duplicates", "Nothing to merge.");
  }

  const scalars: HouseholdScalars = {
    name: String(form.get("name") ?? "").trim() || "Household",
    pickupNotes: emptyToNull(form.get("pickupNotes")),
    primaryContactName: emptyToNull(form.get("primaryContactName")),
    primaryContactPhone: emptyToNull(form.get("primaryContactPhone")),
  };

  try {
    await mergeHouseholdGroup(prisma, { survivorId, losingIds, scalars });
  } catch (error) {
    console.error("household merge failed", error);
    return redirectWithError(
      "/admin/households/duplicates",
      error instanceof Error ? error.message : "Merge failed.",
    );
  }

  return redirectWithSuccess("/admin/households/duplicates", "Households merged.");
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
}

export default function HouseholdDuplicates({ loaderData }: Route.ComponentProps) {
  const { duplicateGroups } = loaderData;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/admin/households"
          className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to households
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Duplicate households
        </h1>
        <p className="text-sm text-white/55">
          These pickup spaces have more than one household. Pick which value
          should win for each field, then merge. All children and dismissal
          exceptions move to the surviving household — nothing is lost.
        </p>
      </header>

      {duplicateGroups.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/60">
          No duplicate households. 🎉
        </p>
      ) : (
        duplicateGroups.map((group) => (
          <DuplicateGroupCard key={group.spaceNumber} group={group} />
        ))
      )}
    </div>
  );
}

function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const survivor = group.households[0]; // oldest = default survivor
  const losingIds = group.households.slice(1).map((h) => h.id).join(",");

  return (
    <Form
      method="post"
      className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-5"
    >
      <input type="hidden" name="survivorId" value={survivor.id} />
      <input type="hidden" name="losingIds" value={losingIds} />

      <h2 className="text-sm font-semibold text-white">
        Space {group.spaceNumber} · {group.households.length} households
      </h2>

      <div className="grid gap-3 md:grid-cols-2">
        {group.households.map((h) => (
          <div key={h.id} className="rounded-lg border border-white/10 p-3">
            <p className="text-sm font-medium text-white">{h.name}</p>
            <p className="text-xs text-white/50">
              {h.students.length} student{h.students.length === 1 ? "" : "s"}:{" "}
              {h.students.map((s) => `${s.firstName} ${s.lastName}`).join(", ") || "—"}
            </p>
          </div>
        ))}
      </div>

      <FieldChooser label="Household name" field="name" group={group} />
      <FieldChooser label="Pickup notes" field="pickupNotes" group={group} />
      <FieldChooser label="Primary contact" field="primaryContactName" group={group} />
      <FieldChooser label="Contact phone" field="primaryContactPhone" group={group} />

      <button
        type="submit"
        className="self-start rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-400"
      >
        Merge into one household
      </button>
    </Form>
  );
}

function FieldChooser({
  label,
  field,
  group,
}: {
  label: string;
  field: "name" | "pickupNotes" | "primaryContactName" | "primaryContactPhone";
  group: DuplicateGroup;
}) {
  // Distinct candidate values across the group; survivor's value is the default.
  const values: string[] = [];
  for (const h of group.households) {
    const v = (h[field] ?? "").toString();
    if (!values.includes(v)) values.push(v);
  }

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium uppercase tracking-wide text-white/45">
        {label}
      </legend>
      {values.map((v, i) => (
        <label key={`${field}-${i}`} className="flex items-center gap-2 text-sm text-white/80">
          <input type="radio" name={field} value={v} defaultChecked={i === 0} />
          <span>{v === "" ? <span className="text-white/40">(empty)</span> : v}</span>
        </label>
      ))}
    </fieldset>
  );
}
```

- [ ] **Step 3: Generate route types**

Run: `npx react-router typegen`
Expected: creates `app/routes/admin/+types/households.duplicates.d.ts` (no error). This resolves the `./+types/households.duplicates` import.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no TS errors in the new route or merge module).

- [ ] **Step 5: Commit**

```bash
git add app/routes.ts app/routes/admin/households.duplicates.tsx
git commit -m "feat(households): add duplicate-households merge view"
```

---

## Task 5: Households list banner

**Files:**
- Create: `app/components/admin/DuplicateHouseholdsBanner.tsx`
- Modify: `app/routes/admin/households.tsx` (loader: add `duplicateSpaceCount`; component: render banner)

- [ ] **Step 1: Create the banner component**

Create `app/components/admin/DuplicateHouseholdsBanner.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, X } from "lucide-react";

const SNOOZE_KEY = "households-dup-banner-snoozed-until";
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Warns staff that some pickup spaces have duplicate households and links to the
 * merge view. SSR-safe: `show` starts false on the server AND on the first
 * client render, so hydration matches. A useEffect then flips it on only when
 * there are duplicates and the banner isn't currently snoozed — no flash, no
 * mismatch. "Dismiss" snoozes it in localStorage for 30 days.
 */
export default function DuplicateHouseholdsBanner({ count }: { count: number }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (count <= 0) return;
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? "0");
    if (Date.now() < until) return;
    setShow(true);
  }, [count]);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    setShow(false);
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        {count} pickup space{count === 1 ? "" : "s"} {count === 1 ? "has" : "have"}{" "}
        duplicate households.{" "}
        <Link to="/admin/households/duplicates" className="font-medium underline">
          Review &amp; merge
        </Link>
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss for 30 days"
        className="rounded p-1 text-amber-100/70 hover:bg-amber-400/10 hover:text-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add `duplicateSpaceCount` to the households loader**

In `app/routes/admin/households.tsx`, add the import near the other `~/domain/households/...` imports:

```ts
import { groupDuplicateHouseholds } from "~/domain/households/merge.server";
```

Then inside the loader, after the existing `Promise.all([...])` destructuring completes (i.e., after the big array assignment, before the `return`), add a query + count. Add this query as a new entry near the other independent queries — simplest is a standalone await after the Promise.all block:

```ts
  // Count pickup spaces that have more than one household (duplicates created
  // by the pre-fix importer). Drives the dismissible banner on this page.
  const householdsWithSpace = await prisma.household.findMany({
    where: { spaceNumber: { not: null } },
    select: { id: true, spaceNumber: true, createdAt: true },
  });
  const duplicateSpaceCount = groupDuplicateHouseholds(householdsWithSpace).length;
```

Add `duplicateSpaceCount` to the loader's returned object (find the `return { ... }` and add the field):

```ts
    duplicateSpaceCount,
```

- [ ] **Step 3: Render the banner in the component**

In the default export component of `app/routes/admin/households.tsx`, destructure `duplicateSpaceCount` from `loaderData` alongside the existing fields, then render the banner near the top of the page's JSX (above the list/stats). Add the import at the top of the file:

```ts
import DuplicateHouseholdsBanner from "~/components/admin/DuplicateHouseholdsBanner";
```

And in the JSX, as the first child inside the page's outermost container:

```tsx
<DuplicateHouseholdsBanner count={duplicateSpaceCount} />
```

(If `loaderData` is destructured at the top of the component, add `duplicateSpaceCount` there; otherwise reference `loaderData.duplicateSpaceCount`.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/DuplicateHouseholdsBanner.tsx app/routes/admin/households.tsx
git commit -m "feat(households): warn about duplicate households with a snoozable banner"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the whole unit-test suite**

Run: `npm test`
Expected: PASS, including the new `roster-import.server.test.ts` (3) and `merge.server.test.ts` (6).

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke (optional, requires local dev + seeded dupes)**

Run: `npm run dev`
- Visit `/admin/households` with duplicate data present → amber banner shows; "Review & merge" links to `/admin/households/duplicates`.
- Dismiss → banner disappears and stays gone on reload (localStorage snooze).
- On the duplicates page, choose field winners and merge a group → toast "Households merged", group disappears, students preserved on the survivor.
- Re-run a roster import with siblings sharing a space → exactly one household.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "test(households): verify dedup + merge end to end" || echo "nothing to commit"
```

---

## Self-Review notes

- **Spec coverage:** importer race fix (Task 1) ✓; space-only dedup (Task 1 tests) ✓; detection (Task 2) ✓; field-by-field merge with children/exceptions preserved (Task 3) ✓; SSR-safe localStorage banner (Task 5) ✓; merge view (Task 4) ✓. No `@@unique` constraint — intentionally deferred per spec.
- **Type consistency:** `HouseholdScalars` defined in Task 3 is reused by the route in Task 4. `groupDuplicateHouseholds`'s `HouseholdLite` (id/spaceNumber/createdAt) is satisfied by the loader selects in Task 4 and Task 5.
- **D1 ordering:** merge reassigns children + exceptions before deleting losers (Task 3 ordering test) — required because of `SetNull`/`Cascade` on delete.
