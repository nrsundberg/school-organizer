# Roster importer household dedup + merge UI

**Date:** 2026-06-15
**Status:** Approved (design)
**Scope:** Stream A only. Streams B (Children/Classrooms page split + count-vs-roster
fix) and C (staff sessions table density) are tracked separately as follow-ups.

## Problem

A recent change moved the per-family pickup space number from `Student` onto
`Household`, and the roster importer was updated to create/look up `Household`
rows keyed by space number (commits `96dd743c`, `2c39a3d2`). After importing,
siblings who share a space number ended up in **separate** households instead of
one shared household.

### Root cause

`applyRosterImport` (`app/domain/csv/roster-import.server.ts`) creates new
students in chunks of 50 using `Promise.all`. Every row in a chunk calls
`getOrCreateHousehold(spaceNumber, lastName)` **concurrently**. The function:

1. checks an in-memory `householdCache`,
2. else `prisma.household.findFirst({ where: { spaceNumber } })`,
3. else creates a new household.

Because all rows in a chunk run in parallel, every sibling on a given space
runs step 2 before any sibling has finished step 3 — they all find nothing and
each creates its own household. The cache only helps *after* a creation
resolves, which never happens in time within a parallel batch.

Secondary issue: there is no DB uniqueness on `(orgId, spaceNumber)` for
households (`prisma/schema.prisma`), so duplicates persist once created. Live
data already contains duplicate households that must be cleaned up.

## Decisions (confirmed with user)

- **Household identity = `spaceNumber` only.** All students on a space are one
  household, regardless of last name.
- **Existing duplicates are fixed via a UI merge tool**, not a bulk auto-merge
  script.
- **Banner snooze lives in `localStorage`** (~30 days), implemented SSR-safely.
- **Merge is field-by-field** for scalar fields; children and dismissal
  exceptions always move to the surviving household.

## Design

### 1. Importer fix — pre-resolve households sequentially

In `applyRosterImport`, before creating any students:

- Collect the set of unique non-null `spaceNumber`s referenced by **both** the
  `new` rows and the `update` rows.
- Resolve them **sequentially** (`for ... of`, awaiting each) through the
  existing `getOrCreateHousehold`, populating `householdCache`. Sequential
  resolution guarantees that the first row for a space creates the household and
  every later row reads it from cache.
- The subsequent `Promise.all` student-creation step then only *reads* the cache
  (synchronous lookup) — no race remains.

New-household name = the last name of the first row encountered for that space
(unchanged behavior). With space-only dedup, a space with mixed last names still
yields one household; staff can rename via the merge view.

When `findFirst` matches one of several pre-existing duplicate households for a
space, it deterministically attaches new/updated students to that one; the merge
view cleans up the rest. No new students are created for already-duplicated
spaces.

`spaceNumber == null` rows continue to get `householdId = null`.

**Not in scope now:** a `@@unique([orgId, spaceNumber])` constraint. Adding it
would fail the migration against existing duplicate data, and the user opted out
of bulk auto-merge. Documented as future hardening once data is clean.

### 2. Duplicate detection + banner (Households list)

`app/routes/admin/households.tsx` loader:

- Compute duplicate groups = households with non-null `spaceNumber` grouped by
  `spaceNumber` where the group size > 1 (scoped to the request's org via the
  tenant Prisma extension).
- Return `duplicateCount` (number of *spaces* affected) to the page.

Banner (SSR-safe, no hydration mismatch, no flash):

```tsx
const [showBanner, setShowBanner] = useState(false); // false on SSR + first client render
useEffect(() => {
  if (duplicateCount > 0 && !isSnoozed()) setShowBanner(true);
}, [duplicateCount]);
```

- `isSnoozed()` reads `localStorage["households-dup-banner-snoozed-until"]` and
  compares to `Date.now()`.
- The banner reads e.g. "N pickup spaces have duplicate households. Review &
  merge" and links to `/admin/households/duplicates`.
- "Dismiss" writes `snoozedUntil = Date.now() + 30 days` to localStorage and
  sets `showBanner(false)`.

### 3. Merge view — `/admin/households/duplicates`

New route (registered in `app/routes.ts`, file
`app/routes/admin/households.duplicates.tsx`), admin-protected like the rest of
`/admin`.

**Loader:** returns each duplicate group: the households sharing a space, each
with its students and current scalar fields (name, pickupNotes,
primaryContactName, primaryContactPhone).

**UI:** one section per space. Within a section, show the candidate households
side-by-side with their students listed (so staff can confirm they belong
together). For each scalar field, a radio group lets staff choose which
household's value wins. A "Merge group" button submits.

**Action (single transaction per group):**

1. Survivor = the household with the lowest id in the group (deterministic,
   id-stable). The chosen scalar field values are written to the survivor.
2. Reassign every other household's `students` to the survivor
   (`student.householdId = survivor.id`).
3. Reassign every other household's `DismissalException`s to the survivor.
4. Delete the now-empty non-survivor households.

Children and exceptions are never lost. After merge, the loader re-runs (RR
re-runs loaders after actions) and the group disappears.

## Data model

No schema changes required for Stream A. Relevant existing models:

- `Household { id, orgId, name, pickupNotes, primaryContactName,
  primaryContactPhone, spaceNumber?, students[], exceptions[] }`
- `Student { id, householdId?, ... }` — FK `householdId -> Household.id`,
  `onDelete: SetNull`.
- `DismissalException` relates to `Household`.

## Testing

- **Importer (unit):** rows for siblings sharing a space → exactly one household;
  rows with different last names on one space → still one household; rows with
  null space → null householdId; update rows attach to the same household as new
  rows on the same space.
- **Detection query (unit):** households grouped by non-null space with size > 1
  are flagged; size-1 and null-space households are not.
- **Merge action (unit):** students and dismissal exceptions from non-survivors
  are reassigned to the survivor; chosen scalar values land on the survivor;
  non-survivors are deleted; runs atomically.

## Out of scope (follow-up specs)

- **Stream B:** split `/admin/children` into a Classrooms page (current look) and
  a Children page (lighter list); fix per-classroom count vs expanded-roster
  mismatch.
- **Stream C:** staff sessions table — reduce per-row height (cells wrap by
  device type, making rows very tall).
