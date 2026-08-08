# Roster Import Prune Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin uploads a student CSV, offer to hard-delete students who are on the roll but absent from the file — as an explicit, previewed, opt-in step.

**Architecture:** `buildRosterImportPlan` is already a pure function over `(rows, snapshot)` and the snapshot already contains every existing student. Removals are therefore a set difference computed at plan time with zero extra queries, surfaced in the existing preview stage, and applied by `applyRosterImport` only when the caller opts in. Deletion is a real `DELETE` — pickup history survives it by design (see below).

**Tech Stack:** Prisma + D1 (SQLite), React Router 7, TypeScript, `node --test` via `tsx`, i18next.

## Global Constraints

- Tests run with `npm test` (glob includes `app/domain/csv/*.test.ts`). No new test runner.
- Any `t("…")` key added to code MUST exist in **both** `public/locales/en/admin.json` and `public/locales/es/admin.json`, or `app/lib/i18n-keys.test.ts` fails the build. Plural keys use i18next v4 suffixes (`_one` / `_other`), matching the existing `skipInvalid_one` / `skipInvalid_other` pattern.
- Destructive behaviour is **opt-in and defaults to off**. A plain re-import must never delete anything.
- Chunk bulk writes at `CHUNK_SIZE = 50`, matching the existing create/update loops in `applyRosterImport`.
- No dynamic imports of internal modules — static top-level imports only.

## Background: why hard delete is safe here

`migrations/0003_add_call_event_history.sql:10` declares:

```sql
FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL
```

and `CallEvent` denormalises `studentName` (NOT NULL) and `homeRoomSnapshot` at call time. Deleting a `Student` nulls the link and **leaves the history row intact with the student's name on it**. `app/routes/admin/history.tsx:606` renders `row.studentName` — the snapshot, not a join — and its summary counter (`:250-251`) already falls back to `unknownStudentNames` when `studentId` is null. That path is live today. Migration `0038` rebuilt the `Student` table and explicitly preserved this FK (see its comment, lines 12-15).

Drill review documents are unaffected: `admin/drills.history.$runId.tsx` and `admin/print.drills.$templateId.tsx` contain no student references — drills are room-based.

What deletion *does* remove, intentionally:

- `DismissalException.student` is `onDelete: Cascade` (`prisma/schema.prisma:627`), so a pruned student's dismissal exceptions go away. Correct — they are forward-looking config, not history.
- Billing self-heals: `countOrgUsage` counts families via `households: { some: {} }` (`app/domain/billing/plan-usage.server.ts:81`), so an emptied household stops counting against the cap with no extra work.

## Background: the matching trap this plan avoids

`rosterKey` (`app/domain/csv/roster-import.server.ts:173-179`) is `firstName + lastName + homeRoom`. That is the right key for deciding create-vs-update, but it is **the wrong key for deciding removal**. The single most common reason to re-import a roster is that students changed classrooms. Keyed on the full `rosterKey`, every promoted student reads as *one removal plus one new student* — hard-deleting them, orphaning their `CallEvent` history, and cascading away their dismissal exceptions.

Removals are therefore keyed on **first + last name only**. A student who appears anywhere in the CSV, under any homeroom, is never a prune candidate. Where the two keys disagree the design under-prunes, which is the safe direction.

---

### Task 1: Compute removals in the plan

**Files:**
- Modify: `app/domain/csv/roster-import.server.ts` — types (`:28-60`), new `rosterNameKey`, `buildRosterImportPlan` (`:433-506`)
- Modify: `app/domain/csv/roster-import.server.test.ts` — new tests

**Interfaces:**
- Produces: `RosterRemovalRow`, `RosterImportPlan.removals: RosterRemovalRow[]`, `RosterImportPlan.summary.removeCount: number`. Consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests**

Append to `app/domain/csv/roster-import.server.test.ts`. Add `buildRosterImportPlan` and the two types to the existing import on line 10:

```ts
import {
  applyRosterImport,
  buildRosterImportPlan,
  type ExistingRosterSnapshot,
  type RosterImportRow,
  type RosterPrisma,
} from "./roster-import.server";
```

Then append:

```ts
function snapshot(
  students: ExistingRosterSnapshot["students"],
): ExistingRosterSnapshot {
  return { students, teachers: [], spaces: [] };
}

test("buildRosterImportPlan: flags students absent from the CSV as removals", () => {
  const plan = buildRosterImportPlan(
    [row(2, "Ada", "Lovelace", 12)],
    snapshot([
      { id: 1, firstName: "Ada", lastName: "Lovelace", homeRoom: "Room 12", spaceNumber: 12 },
      { id: 2, firstName: "Grace", lastName: "Hopper", homeRoom: "Room 9", spaceNumber: 9 },
    ]),
  );

  assert.equal(plan.summary.removeCount, 1);
  assert.deepEqual(
    plan.removals.map((r) => r.studentId),
    [2],
    "only the student missing from the CSV is a removal",
  );
});

test("buildRosterImportPlan: a student who changed homeroom is NOT a removal", () => {
  // The regression this whole design exists to prevent. `rosterKey` includes
  // homeRoom, so Ada reads as "new" here — but she is plainly still enrolled,
  // and deleting her would orphan her CallEvent history.
  const plan = buildRosterImportPlan(
    [{ rowNumber: 2, firstName: "Ada", lastName: "Lovelace", homeRoom: "Room 99", spaceNumber: 12 }],
    snapshot([
      { id: 1, firstName: "Ada", lastName: "Lovelace", homeRoom: "Room 12", spaceNumber: 12 },
    ]),
  );

  assert.equal(plan.summary.removeCount, 0);
  assert.deepEqual(plan.removals, []);
});

test("buildRosterImportPlan: removal matching ignores case and surrounding space", () => {
  const plan = buildRosterImportPlan(
    [{ rowNumber: 2, firstName: "  ADA ", lastName: "lovelace", homeRoom: "Room 12", spaceNumber: 12 }],
    snapshot([
      { id: 1, firstName: "Ada", lastName: "Lovelace", homeRoom: "Room 12", spaceNumber: 12 },
    ]),
  );

  assert.equal(plan.summary.removeCount, 0);
});

test("buildRosterImportPlan: an empty roster yields no removals", () => {
  const plan = buildRosterImportPlan([], snapshot([]));
  assert.equal(plan.summary.removeCount, 0);
  assert.deepEqual(plan.removals, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test app/domain/csv/roster-import.server.test.ts`
Expected: FAIL — `plan.summary.removeCount` is `undefined`, and `buildRosterImportPlan` / `ExistingRosterSnapshot` may not yet be in the import list.

- [ ] **Step 3: Add the removal types**

In `app/domain/csv/roster-import.server.ts`, immediately after the `RosterPreviewRow` type (`:40-44`), add:

```ts
/**
 * An existing student who is on the roll but absent from the uploaded CSV —
 * i.e. a candidate for deletion. Carries enough detail for the preview to
 * name them, so the admin is confirming people rather than a bare count.
 */
export type RosterRemovalRow = {
  studentId: number;
  firstName: string;
  lastName: string;
  homeRoom: string | null;
  spaceNumber: number | null;
};
```

Then extend `RosterImportPlan` (`:46-60`) — add `removeCount` to `summary` and `removals` alongside `newHomerooms`:

```ts
export type RosterImportPlan = {
  rows: RosterPreviewRow[];
  summary: {
    validRows: number;
    createCount: number;
    updateCount: number;
    errorCount: number;
    /** Existing students absent from the CSV. Deleted only if the caller opts in. */
    removeCount: number;
    newHomerooms: number;
    newSpaces: number;
    /** Net new households: unique new space numbers + new students with no space number. */
    newFamilies: number;
  };
  removals: RosterRemovalRow[];
  newHomerooms: string[];
  newSpaces: number[];
};
```

- [ ] **Step 4: Add the name-only key**

In the same file, immediately after `rosterKey` (`:173-179`), add:

```ts
/**
 * Identity key for *removal* decisions: first + last name, normalised.
 *
 * Deliberately NOT `rosterKey`, which also includes homeRoom. Re-importing a
 * roster after class assignments change is the common case; under the full
 * key every promoted student would read as one removal plus one new student,
 * hard-deleting them and orphaning their CallEvent history. Matching on name
 * alone means a student listed anywhere in the CSV is never pruned.
 *
 * Two enrolled students who genuinely share a first and last name collapse to
 * one key, so neither is pruned while either appears in the file. That
 * under-prunes, which is the safe direction for a destructive operation.
 */
function rosterNameKey(row: Pick<RosterImportRow, "firstName" | "lastName">): string {
  return [normalizeKeyPart(row.firstName), normalizeKeyPart(row.lastName)].join(" ");
}
```

- [ ] **Step 5: Compute removals in `buildRosterImportPlan`**

In `buildRosterImportPlan`, after the `previewRows` mapping closes (`:477`) and before `const createCount` (`:479`), insert:

```ts
  // Set difference: on the roll, absent from the file. Every row the caller
  // supplied counts as "present" — including rows that failed validation, so
  // a typo'd row never escalates into a deletion.
  const csvNameKeys = new Set(rows.map(rosterNameKey));
  const removals: RosterRemovalRow[] = snapshot.students
    .filter((student) => !csvNameKeys.has(rosterNameKey(student)))
    .map((student) => ({
      studentId: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      homeRoom: student.homeRoom,
      spaceNumber: student.spaceNumber,
    }));
```

- [ ] **Step 6: Return them**

In the same function's return statement, add `removeCount: removals.length,` to `summary` (after `errorCount`) and `removals,` after the `summary` object:

```ts
  return {
    rows: previewRows,
    summary: {
      validRows: rows.length,
      createCount,
      updateCount,
      errorCount,
      removeCount: removals.length,
      newHomerooms: newHomeroomsByKey.size,
      newSpaces: plannedSpaces.size,
      newFamilies,
    },
    removals,
    newHomerooms: Array.from(newHomeroomsByKey.values()).sort((a, b) =>
      a.localeCompare(b),
    ),
    newSpaces: Array.from(plannedSpaces).sort((a, b) => a - b),
  };
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx tsx --test app/domain/csv/roster-import.server.test.ts`
Expected: PASS — the 3 pre-existing tests plus the 4 new ones.

- [ ] **Step 8: Commit**

```bash
git add app/domain/csv/roster-import.server.ts app/domain/csv/roster-import.server.test.ts
git commit -m "feat(roster-import): compute removal candidates in the import plan

Keyed on first+last name only, not rosterKey — rosterKey includes
homeRoom, so keying removals on it would read every student who changed
classrooms as a delete-and-recreate."
```

---

### Task 2: Apply removals behind an opt-in flag

**Files:**
- Modify: `app/domain/csv/roster-import.server.ts` — `RosterPrisma` (`:69-128`), `RosterApplySummary` (`:62-67`), `applyRosterImport` (`:544-678`)
- Modify: `app/domain/csv/roster-import.server.test.ts` — extend `makeFakePrisma`, new tests

**Interfaces:**
- Consumes: `plan.removals` from Task 1.
- Produces: `applyRosterImport(prisma, rows, prebuiltPlan?, options?: { prune?: boolean })`, and `RosterApplySummary.removed: number`. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

In `app/domain/csv/roster-import.server.test.ts`, extend `makeFakePrisma` so the fake satisfies the widened `RosterPrisma`. Add a `deletedStudentIds` array beside `createdStudents`:

```ts
  const deletedStudentIds: number[] = [];
```

add `deleteMany` to the fake's `student` object (after `update`):

```ts
      deleteMany: async ({ where }) => {
        deletedStudentIds.push(...where.id.in);
        return {};
      },
```

and include it in the return:

```ts
  return { prisma, createdHouseholds, createdStudents, deletedStudentIds };
```

Then append these tests:

```ts
const EXISTING_GRACE: ExistingRosterSnapshot["students"] = [
  { id: 7, firstName: "Grace", lastName: "Hopper", homeRoom: "Room 9", spaceNumber: 9 },
];

test("applyRosterImport: does NOT delete when prune is not requested", async () => {
  const { prisma, deletedStudentIds } = makeFakePrisma({
    students: EXISTING_GRACE.map((s) => ({ ...s, household: { spaceNumber: s.spaceNumber } })),
  });

  const result = await applyRosterImport(prisma, [row(2, "Ada", "Lovelace", 12)]);

  assert.equal(result.ok, true);
  assert.deepEqual(deletedStudentIds, [], "a plain re-import is never destructive");
  assert.equal(result.ok && result.data.removed, 0);
});

test("applyRosterImport: deletes absent students when prune is requested", async () => {
  const { prisma, deletedStudentIds } = makeFakePrisma({
    students: EXISTING_GRACE.map((s) => ({ ...s, household: { spaceNumber: s.spaceNumber } })),
  });

  const result = await applyRosterImport(
    prisma,
    [row(2, "Ada", "Lovelace", 12)],
    undefined,
    { prune: true },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(deletedStudentIds, [7]);
  assert.equal(result.ok && result.data.removed, 1);
});

test("applyRosterImport: prune with nothing to remove issues no delete", async () => {
  const { prisma, deletedStudentIds } = makeFakePrisma();

  const result = await applyRosterImport(
    prisma,
    [row(2, "Ada", "Lovelace", 12)],
    undefined,
    { prune: true },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(deletedStudentIds, []);
  assert.equal(result.ok && result.data.removed, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test app/domain/csv/roster-import.server.test.ts`
Expected: FAIL — `applyRosterImport` takes no 4th argument and `result.data.removed` is `undefined`.

- [ ] **Step 3: Widen the `RosterPrisma` port**

In `app/domain/csv/roster-import.server.ts`, add to the `student` block of `RosterPrisma` (after `update`, `:97-100`):

```ts
    deleteMany: (args: { where: { id: { in: number[] } } }) => Promise<unknown>;
```

- [ ] **Step 4: Add `removed` to the summary type**

Change `RosterApplySummary` (`:62-67`) to:

```ts
export type RosterApplySummary = {
  created: number;
  updated: number;
  /** Students hard-deleted because they were absent from the CSV. 0 unless pruning was requested. */
  removed: number;
  newHomerooms: number;
  newSpaces: number;
};
```

- [ ] **Step 5: Accept the option and perform the deletes**

Change the `applyRosterImport` signature (`:544-548`) to:

```ts
export async function applyRosterImport(
  prisma: RosterPrisma,
  rows: RosterImportRow[],
  prebuiltPlan?: RosterImportPlan,
  options?: { prune?: boolean },
): Promise<ServerResult<RosterApplySummary>> {
```

Then, after the update loop closes (`:659`) and before the final `return`, insert:

```ts
  // Removals run last, after every create and update has landed. Ordering
  // matters: a student who moved classrooms is an `update` above and is
  // absent from `plan.removals` (removals key on name only), so the two sets
  // are disjoint — but running deletes last means a mid-import failure leaves
  // the roster over-populated rather than under-populated.
  //
  // This is a real DELETE. Pickup history survives it: CallEvent.studentId is
  // ON DELETE SET NULL and the row carries a `studentName` snapshot, so
  // /admin/history still shows these students. DismissalException rows DO
  // cascade away, which is intended — they are future config, not history.
  let removed = 0;
  if (options?.prune && plan.removals.length > 0) {
    const ids = plan.removals.map((r) => r.studentId);
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      await prisma.student.deleteMany({
        where: { id: { in: ids.slice(i, i + CHUNK_SIZE) } },
      });
    }
    removed = ids.length;
  }
```

- [ ] **Step 6: Report it**

In the same function's final `return`, add `removed,` to `data` (after `updated`):

```ts
    data: {
      created: plan.summary.createCount,
      updated: plan.summary.updateCount,
      removed,
      newHomerooms: plan.summary.newHomerooms,
      newSpaces: plan.summary.newSpaces,
    },
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx tsx --test app/domain/csv/roster-import.server.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 8: Commit**

```bash
git add app/domain/csv/roster-import.server.ts app/domain/csv/roster-import.server.test.ts
git commit -m "feat(roster-import): opt-in prune of students absent from the CSV"
```

---

### Task 3: Offer the prune in the preview UI

**Files:**
- Modify: `app/routes/admin/roster-import.tsx` — apply branch (`:253-330`), preview component (`:620-652`)
- Modify: `public/locales/en/admin.json`
- Modify: `public/locales/es/admin.json`

**Interfaces:**
- Consumes: `plan.removals`, `plan.summary.removeCount` (Task 1); `applyRosterImport`'s `options.prune` and `summary.removed` (Task 2).

`localizePlan` (`:97-105`) spreads `...plan`, so `removals` reaches the client with no change needed there.

- [ ] **Step 1: Read the prune flag in the apply branch**

In `app/routes/admin/roster-import.tsx`, inside `if (intent === "apply")`, immediately after the `rows` parse `try`/`catch` block closes (it starts at `:256`; insert after its closing brace, before `const plan = await buildRosterImportPlanFromDatabase`), add:

```ts
    // Opt-in and default-off: absent the checkbox, a re-import never deletes.
    const prune = formData.get("prune") === "on";
```

- [ ] **Step 2: Pass it through**

Change the `applyRosterImport` call (`:287-291`) to:

```ts
    const result = await applyRosterImport(
      prisma as unknown as RosterPrisma,
      rows,
      plan,
      { prune },
    );
```

- [ ] **Step 3: Report removals in the success toast**

Replace the `const message = …` block (starts at `:307`; note there is a second, unrelated `const message =` at `:206` in the *preview* branch — do not touch that one) with:

```ts
    const message =
      summary.removed > 0
        ? t("rosterImport.actions.importedSummaryWithRemovals", {
            count: summary.created,
            created: summary.created,
            updated: summary.updated,
            removed: summary.removed,
          })
        : summary.newHomerooms > 0
          ? t("rosterImport.actions.importedSummaryWithHomerooms", {
              count: summary.created,
              created: summary.created,
              updated: summary.updated,
              homerooms: summary.newHomerooms,
            })
          : t("rosterImport.actions.importedSummary", {
              count: summary.created,
              created: summary.created,
              updated: summary.updated,
            });
```

- [ ] **Step 4: Record it in the audit log**

In the same branch, add `removed` to the `auditOrgAction` payload (`:326`):

```ts
      payload: {
        created: summary.created,
        updated: summary.updated,
        removed: summary.removed,
        newHomerooms: summary.newHomerooms,
      },
```

- [ ] **Step 5: Add the opt-in control to the preview**

In the preview component, find the `skipInvalid` checkbox `</label>` and its trailing `) : null}` (`:627-628`). Insert immediately after that `) : null}`:

```tsx
      {preview.plan.removals.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-300/25 bg-amber-300/5 p-3">
          <label className="flex items-start gap-2 text-sm font-semibold text-amber-100">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={prune}
              onChange={(event) => setPrune(event.currentTarget.checked)}
            />
            {t("rosterImport.preview.prune", {
              count: preview.plan.removals.length,
            })}
          </label>
          <p className="mt-1.5 pl-6 text-xs text-white/60">
            {t("rosterImport.preview.pruneWarning")}
          </p>
          <ul className="mt-2 max-h-40 overflow-y-auto pl-6 text-xs text-white/70">
            {preview.plan.removals.map((r) => (
              <li key={r.studentId}>
                {r.firstName} {r.lastName}
                {r.homeRoom ? ` · ${r.homeRoom}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
```

- [ ] **Step 6: Add the checkbox state**

Find the `const [skipInvalid, setSkipInvalid] = useState(...)` declaration in the same component and add directly below it:

```tsx
  // Defaults to false: deleting students is never the default outcome of an upload.
  const [prune, setPrune] = useState(false);
```

- [ ] **Step 7: Submit the flag**

In the apply `<Form method="post">` (`:631-634`), add a third hidden input after `rowsJson`:

```tsx
          <input type="hidden" name="prune" value={prune ? "on" : "off"} />
```

The i18n keys land in this same task, not a follow-up one: `app/lib/i18n-keys.test.ts` fails the moment code references a key that no locale file defines, so splitting them would leave `npm test` red between two commits.

- [ ] **Step 8: Add the English strings**

In `public/locales/en/admin.json`, inside `rosterImport.preview`, add:

```json
    "prune_one": "Also remove {{count}} student who is no longer on this roster",
    "prune_other": "Also remove {{count}} students who are no longer on this roster",
    "pruneWarning": "Removed students are deleted permanently and disappear from the board. Their pickup history is kept — past call records stay in Activity under their name. Any upcoming dismissal exceptions for them are discarded.",
```

Inside `rosterImport.actions`, add:

```json
    "importedSummaryWithRemovals_one": "Imported {{created}} new student, updated {{updated}} existing student, and removed {{removed}}.",
    "importedSummaryWithRemovals_other": "Imported {{created}} new students, updated {{updated}} existing students, and removed {{removed}}.",
```

Also update `rosterImport.preview.intro` so the description matches what confirming now does:

```json
    "intro": "Nothing has been written yet. Confirming will create missing homerooms and board spaces, create new students, and update matching students by first name, last name, and homeroom. Students already on the roll are only removed if you tick the removal box below.",
```

- [ ] **Step 9: Add the Spanish strings**

In `public/locales/es/admin.json`, inside `rosterImport.preview`:

```json
    "prune_one": "También eliminar {{count}} estudiante que ya no está en esta lista",
    "prune_other": "También eliminar {{count}} estudiantes que ya no están en esta lista",
    "pruneWarning": "Los estudiantes eliminados se borran de forma permanente y desaparecen del tablero. Se conserva su historial de recogida: los registros anteriores siguen en Actividad con su nombre. Se descartan las excepciones de salida pendientes.",
```

Inside `rosterImport.actions`:

```json
    "importedSummaryWithRemovals_one": "Se importó {{created}} estudiante nuevo, se actualizó {{updated}} existente y se eliminó {{removed}}.",
    "importedSummaryWithRemovals_other": "Se importaron {{created}} estudiantes nuevos, se actualizaron {{updated}} existentes y se eliminaron {{removed}}.",
```

And update `intro` to match the English edit:

```json
    "intro": "Todavía no se ha escrito nada. Al confirmar se crearán las aulas y los espacios del tablero que falten, se crearán los estudiantes nuevos y se actualizarán los estudiantes coincidentes por nombre, apellido y aula. Los estudiantes que ya están en la lista solo se eliminan si marcas la casilla de eliminación.",
```

- [ ] **Step 10: Run the i18n guard**

Run: `npx tsx --test app/lib/i18n-keys.test.ts`
Expected: PASS. A failure means a referenced key is missing, or `en` and `es` disagree — fix the JSON, never the test.

- [ ] **Step 11: Typecheck and run the full suite**

Run: `npx react-router typegen && npx tsc --noEmit && npm test`
Expected: no type errors, all tests PASS.

- [ ] **Step 12: Commit**

```bash
git add app/routes/admin/roster-import.tsx public/locales/en/admin.json public/locales/es/admin.json
git commit -m "feat(roster-import): opt-in prune control in the import preview"
```

---

### Task 4: Clean up households emptied by a prune

**Files:**
- Modify: `app/domain/csv/roster-import.server.ts` — `ExistingRosterSnapshot` (`:28-38`), `RosterPrisma`, `RosterRemovalRow`, `buildRosterImportPlanFromDatabase` (`:508-542`), `applyRosterImport`
- Modify: `app/domain/csv/roster-import.server.test.ts`

**Interfaces:**
- Consumes: the prune deletes from Task 2.
- Produces: no new public surface — `Household` rows left with zero students are removed.

Pruning the last student out of a household leaves an empty `Household` behind. Billing already ignores it (`households: { some: {} }`), but the row keeps the departed family's `name` against its space number — so a new family moving into that space inherits a stale surname on the board. Cleanup is scoped strictly to households the prune actually emptied; unrelated empty households are left untouched.

- [ ] **Step 1: Write the failing test**

Append to `app/domain/csv/roster-import.server.test.ts`:

```ts
test("applyRosterImport: prune deletes households it empties, and only those", async () => {
  const { prisma, deletedHouseholdIds } = makeFakePrisma({
    students: [
      {
        id: 7,
        firstName: "Grace",
        lastName: "Hopper",
        homeRoom: "Room 9",
        householdId: "h-old",
        household: { spaceNumber: 9 },
      },
    ],
  });

  const result = await applyRosterImport(
    prisma,
    [row(2, "Ada", "Lovelace", 12)],
    undefined,
    { prune: true },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(deletedHouseholdIds, ["h-old"]);
});
```

Extend `makeFakePrisma`: add `householdId?: string | null` to its local `ExistingSnapshot["students"]` element type, add `const deletedHouseholdIds: string[] = [];`, add to the fake's `household` object:

```ts
      deleteMany: async ({ where }) => {
        deletedHouseholdIds.push(...where.id.in);
        return {};
      },
```

and return `deletedHouseholdIds` alongside the rest.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test app/domain/csv/roster-import.server.test.ts`
Expected: FAIL — `deletedHouseholdIds` is `undefined` or empty.

- [ ] **Step 3: Carry `householdId` through the snapshot**

In `roster-import.server.ts`, add `householdId: string | null;` to the student element of `ExistingRosterSnapshot` (`:29-35`) and to `RosterRemovalRow`.

Widening `ExistingRosterSnapshot` breaks the snapshot literals written in Task 1 — they construct students without a `householdId`. Fix them now: in `app/domain/csv/roster-import.server.test.ts`, add `householdId: null,` to every student object passed to the `snapshot()` helper (the three `buildRosterImportPlan` tests) and to `EXISTING_GRACE`. Run `npx tsc --noEmit` after this step; it should report no errors in the test file before you continue.

In `RosterPrisma.student.findMany`, add `householdId: true;` to the `select` type. In `RosterPrisma.household`, add:

```ts
    deleteMany: (args: {
      where: { id: { in: string[] }; students: { none: Record<string, never> } };
    }) => Promise<unknown>;
```

- [ ] **Step 4: Select it from the database**

In `buildRosterImportPlanFromDatabase` (`:513-522`), add `householdId: true,` to the `select`, and carry it in the `students` mapping (`:533-539`):

```ts
  const students = rawStudents.map((s) => ({
    id: s.id,
    firstName: s.firstName,
    lastName: s.lastName,
    homeRoom: s.homeRoom,
    householdId: s.householdId,
    spaceNumber: s.household?.spaceNumber ?? null,
  }));
```

In `buildRosterImportPlan`'s removals mapping (Task 1, Step 5), add `householdId: student.householdId,`.

- [ ] **Step 5: Delete the emptied households**

In `applyRosterImport`, inside the `if (options?.prune && …)` block, after the delete loop and before `removed = ids.length;`, add:

```ts
    // Scoped strictly to households these deletions touched, and guarded by
    // `students: { none: {} }` so a household that still holds a sibling —
    // or one that was already empty for unrelated reasons — is left alone.
    const touchedHouseholdIds = [
      ...new Set(plan.removals.map((r) => r.householdId).filter((id): id is string => id != null)),
    ];
    if (touchedHouseholdIds.length > 0) {
      for (let i = 0; i < touchedHouseholdIds.length; i += CHUNK_SIZE) {
        await prisma.household.deleteMany({
          where: {
            id: { in: touchedHouseholdIds.slice(i, i + CHUNK_SIZE) },
            students: { none: {} },
          },
        });
      }
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsx --test app/domain/csv/roster-import.server.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add app/domain/csv/roster-import.server.ts app/domain/csv/roster-import.server.test.ts
git commit -m "feat(roster-import): drop households emptied by a prune"
```

---

### Task 5: End-to-end verification

**Files:**
- Modify: `e2e/flows/admin-roster.spec.ts`

This file already uses the seeded-tenant fixture — `import { test, expect } from "../fixtures/seeded-tenant"`, giving each test `{ page, tenant }` with `tenant.adminCookie`, `tenant.tenantUrl(path)`, and `tenant.homeroomName`. Reuse it; do not add a new fixture.

- [ ] **Step 1: Find the file input's selector**

Run: `rg -n "type=\"file\"|input|accept" app/components/FileChooser.tsx`

The upload stage of `/admin/roster-import` renders this component. Note the input's `name` (and whether it is visually hidden — if so, use `locator('input[type=file]')` rather than a role query, since hidden inputs are not exposed by role).

- [ ] **Step 2: Add the prune case**

Append to `e2e/flows/admin-roster.spec.ts`. Substitute the file-input selector from Step 1 where marked, and adjust the import-button name if Step 1's page copy differs:

```ts
test.describe("@flow admin-roster — CSV prune", () => {
  test("prune removes absent students only when the box is ticked", async ({ page, tenant }) => {
    await page.context().addCookies([tenant.adminCookie]);

    const upload = async (csv: string) => {
      await page.goto(tenant.tenantUrl("/admin/roster-import"));
      // Selector confirmed in Step 1.
      await page.locator('input[type="file"]').setInputFiles({
        name: "roster.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv, "utf8"),
      });
      await page.getByRole("button", { name: /preview|continue|map/i }).first().click();
    };

    const both =
      `firstName,lastName,homeRoom\nAda,Lovelace,${tenant.homeroomName}\nGrace,Hopper,${tenant.homeroomName}\n`;
    const adaOnly = `firstName,lastName,homeRoom\nAda,Lovelace,${tenant.homeroomName}\n`;

    // Seed both students.
    await upload(both);
    await page.getByRole("button", { name: /import \d+ rows?/i }).click();

    // Re-upload without Grace: the prune control names her and starts off.
    await upload(adaOnly);
    const pruneBox = page.getByRole("checkbox", { name: /no longer on this roster/i });
    await expect(pruneBox).not.toBeChecked();
    await expect(page.getByText("Grace Hopper")).toBeVisible();

    // Importing without ticking it must not delete her.
    await page.getByRole("button", { name: /import \d+ rows?/i }).click();
    await page.goto(tenant.tenantUrl("/admin/children"));
    await expect(page.getByText(/Hopper/).first()).toBeVisible();

    // Ticking it does delete her.
    await upload(adaOnly);
    await page.getByRole("checkbox", { name: /no longer on this roster/i }).check();
    await page.getByRole("button", { name: /import \d+ rows?/i }).click();
    await page.goto(tenant.tenantUrl("/admin/children"));
    await expect(page.getByText(/Hopper/)).toHaveCount(0);
  });
});
```

- [ ] **Step 3: Point Playwright's browser cache off the rootfs, then install**

```bash
export PLAYWRIGHT_BROWSERS_PATH="$(ls -d /sessions/*/mnt/outputs 2>/dev/null | head -1)/.ms-playwright"
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
npx playwright install chromium
```

Skip entirely if not on a Cowork sandbox. Never run a bare `npx playwright install`.

- [ ] **Step 4: Run the spec**

Run: `npx playwright test e2e/flows/admin-roster.spec.ts`
Expected: PASS.

- [ ] **Step 5: Clean up**

```bash
npm run clean:e2e && npm run clean:tmp
```

- [ ] **Step 6: Commit**

```bash
git add e2e/flows/admin-roster.spec.ts
git commit -m "test(e2e): roster prune is opt-in and names who it removes"
```

---

## Manual smoke check (after Task 4)

The one behaviour worth confirming by hand, because it is the whole justification for hard delete:

1. `npm run dev:worker`, sign in as admin against a seeded tenant with a migrated local D1.
2. Call a student on the board so they get a `CallEvent` row. Confirm they appear in `/admin/history`.
3. Re-upload a roster CSV omitting that student. Tick the removal box. Import.
4. Confirm they are gone from `/admin/children` and the board.
5. **Confirm they still appear by name in `/admin/history`**, and that the history CSV export still carries their name with a blank `studentId`.
6. Re-upload a roster where a retained student has a *different* homeroom. Confirm they show as an update, `removeCount` is 0, and their history is untouched.
