# Research spec — Priority 1 / roster-csv-import

**Author:** polish agent (manual-1438 run), 2026-04-23.
**Workstream:** Priority 1, item 1 in `docs/nightly-queue.md` (slug
`roster-csv-import`).
**Status:** research only — no code changed in this run.
**Picked because:** tonight's build agent was working 0d
(`interaction-tests-critical-paths`) on branch
`nightly-build/2026-04-23-manual-1438` and never published a summary,
so polish skipped Part A per the manual-1438 override and took the
next highest-priority queued item in `docs/nightly-queue.md`. 0d is
covered by an earlier spec (`2026-04-23-interaction-tests-critical-paths.md`);
the next unstarted priority after it is Priority 1 item #1.

---

## Problem

A school can have 400–900 students. Onboarding via
`app/routes/create/create.student.tsx` is one-at-a-time: you type a
first name, last name, optional homeroom (must already exist), and an
optional numeric space. That is the single biggest onboarding friction
we have and every pilot conversation stalls on it. Without a bulk
import path, a salesperson's demo ends with "great, now go hand-enter
your roster and call us back in three hours."

Per `docs/nightly-queue.md` item 1, we need an admin-side importer that
accepts a CSV or XLSX file, previews parsed rows, validates, and
bulk-inserts/updates students (and their homerooms and optional space
assignments) in one transaction — on every plan tier, not just Campus.

## Current state

### How students are created today

- **Route:** `app/routes/create/create.student.tsx` (registered in
  `app/routes.ts` under `prefix("create", [...])`).
- **Action shape:** reads `firstName`, `lastName`, optional `homeRoom`
  (must match an existing `Teacher.homeRoom`), optional numeric
  `spaceNum`. If `spaceNum` is provided and the `Space` row doesn't
  exist, it `upsert`s the Space. Rejects homerooms that don't already
  exist.
- **Plan usage:** calls `countOrgUsage`, `familiesDeltaForNewStudent`,
  and `assertUsageAllowsIncrement` from
  `app/domain/billing/plan-usage.server.ts` to enforce seat caps
  *before* the insert. Throws `PlanLimitError` on violation; the
  catch returns `{ error }` back to the form. `syncUsageGracePeriod`
  is called post-insert to keep the `Org.usageGracePeriodEndsAt`
  accurate.
- **Household linkage:** sets `householdId: null` on the create —
  sibling-grouping is only hit during later edits today.
- **Data model (`prisma/schema.prisma`, lines 340–360):**
  `Student { id, orgId, firstName, lastName, householdId?, spaceNumber?, homeRoom? }`
  — `homeRoom` is an FK to `Teacher.homeRoom` (`@unique`) and
  `spaceNumber` is an FK to `Space.spaceNumber` (`@unique`).

### Admin sidebar today

`app/components/admin/AdminSidebar.tsx` exports a flat `navItems`
array. Order today: Dashboard → Users → Children & Classes → Drills →
History → Branding → Billing. The queue asks the new entry to sit
between "Children & Classes" and "Drills" (queue says "Fire drill",
but that's since been renamed to "Drills" — noting the discrepancy so
the build agent isn't confused).

### Multi-tenant Prisma access

`getTenantPrisma(context)` returns a Prisma client scoped to the
current tenant via `~/domain/utils/global-context.server` — covered
by the tenant-scoping extension documented in
`docs/multi-tenant-prisma-extension.md`. **All** DB calls in the new
route must go through this helper, not a raw `new PrismaClient()`,
otherwise `orgId` defaults silently to `org_tome` (see
`Student.orgId` `@default("org_tome")` in the schema — a known tripwire
for new code).

### No CSV/XLSX parser today

`package.json` currently has no `papaparse`, `xlsx`/`sheetjs`, or
`csv-parse` dependency. (The queue says "SheetJS is already on the
frontend whitelist" — that refers to Claude's in-browser artifact
allow-list, not an installed npm package. The build agent needs to
install one.)

### Rate limiting + audit logging exist

- `docs/rate-limiting.md` documents two Worker rate-limit bindings:
  `RL_AUTH` and `RL_BILLING`. Neither is appropriate for bulk
  import; a new binding (`RL_IMPORT`) keyed on `import:<orgId>` is the
  right pattern (5 req / 60 s is plenty — import is a human action).
- `OrgAuditLog` exists (`prisma/schema.prisma` line 112) and billing
  already uses it; we should log every confirmed import with the
  summary counts so support can reconstruct what a school did.

## Proposal

### Route + file layout

- **Admin route** (new): `app/routes/admin/roster-import.tsx`.
  - Registered in `app/routes.ts` inside the existing
    `route("admin", "routes/admin/layout.tsx", [...])` array,
    alphabetically near `children`:
    `route("roster-import", "routes/admin/roster-import.tsx")`.
  - Gated by the admin layout's existing auth+role check — no extra
    guard needed.

- **Server helpers** (new):
  - `app/domain/roster/parse-roster-file.server.ts` — one function
    `parseRosterFile(buffer, filename) → { rows, errors }`. Detects
    CSV vs XLSX by extension (case-insensitive) and content sniff
    (first 8 bytes: ZIP local file header `PK\x03\x04` = XLSX; else
    CSV). Returns rows as `{ rowNumber, firstName, lastName, homeRoom, spaceNumber?, grade?, guardianEmail? }[]` plus per-row errors.
  - `app/domain/roster/apply-roster-import.server.ts` — one function
    `applyRosterImport(prisma, orgId, rows) → { created, updated, skipped, newHomerooms, newSpaces }`. Runs inside `prisma.$transaction`.
    Creates missing Teachers and Spaces, then upserts Students. See
    "Dedupe rule" below.

- **Component** (new): `app/components/admin/RosterImportPreview.tsx`
  — pure presentational table for the first 25 rows with per-row
  status badges (NEW / UPDATE / ERROR-reason). Kept in its own file
  so the import route stays under 300 lines.

- **Downloadable CSV template**: serve from
  `app/routes/admin/roster-template.csv.ts` returning a
  `text/csv; charset=utf-8` response with headers row only. Keeps
  the download lifecycle inside the route tree — avoids a public
  `/public/static/roster-template.csv` that a scraper could hit and
  avoids the worker asset pipeline entirely.

### UX flow

1. **Landing state** (no file yet): heading "Import roster",
   short helper text ("Upload a CSV or XLSX with columns firstName,
   lastName, homeRoom. Optional: spaceNumber, grade, guardianEmail."),
   `<a href="/admin/roster-template.csv" download>Download template
   (CSV)</a>`, `<input type=file accept=".csv,.xlsx,.xls">`, and a
   CTA button "Preview".
2. **Preview state** (post-parse, pre-commit): table of first 25
   parsed rows + total row count + counts of NEW / UPDATE / ERROR.
   Validation errors shown per row with red badge + reason. If the
   file has any ERROR rows the "Import N rows" CTA is disabled and
   the helper text says "fix the errors in your file and re-upload".
   Show two secondary CTAs: "Cancel" and "Upload different file".
3. **Processing state**: disable the form, show a spinner, the
   server streams nothing — it's a single `POST` that either succeeds
   or returns an error. Because a 400-row import can take ~4s on D1
   under the current worker-per-row Prisma pattern, wire a progress
   hint: "Importing {n} students… this can take a moment."
4. **Success state**: redirect to `/admin/children` with a
   `redirectWithSuccess` toast: "Imported {created} new students,
   updated {updated} existing, created {newHomerooms} new
   homerooms." Post-import audit row written to `OrgAuditLog`.

**Plan-limit failure** mid-import: show an inline error on the
preview page — "Your current plan allows {n} students. This import
would create {n+m}. Upgrade or remove {m} rows and re-upload." The
transaction is rolled back; nothing lands. No partial imports.

### Dedupe rule

Per the queue: match on `(firstName, lastName, homeRoom)` scoped to
the tenant's `orgId`. Because `Teacher.homeRoom` is unique *globally*
in the current schema (not per-tenant), a homeroom string fully
identifies a Teacher row. Matching logic:

- If `(firstName, lastName, homeRoom)` triple matches an existing
  Student row **within this org** → treated as UPDATE. The only
  fields that get overwritten on update are `spaceNumber` and
  `householdId` (leave `householdId` alone unless the file carries
  family-info columns we're not handling this round). Leave
  `firstName`/`lastName`/`homeRoom` alone on update — by definition
  they match. `grade` and `guardianEmail` are accepted but currently
  don't have columns on `Student`; silently drop with a note in the
  preview ("guardianEmail ignored — not yet in schema").
- If the triple doesn't match → INSERT.
- If `firstName` or `lastName` is blank → ERROR row, skipped.
- If `homeRoom` is blank → allowed (the schema permits
  `homeRoom: null`). Dedupe then falls back to
  `(firstName, lastName, homeRoom=null)`.
- If `homeRoom` doesn't yet exist as a Teacher → **create the
  Teacher first** inside the same transaction (the current
  single-student flow *rejects* unknown homerooms, but that's
  because it's a one-off form; bulk import where the file is the
  source of truth should create new homerooms on demand and report
  the count in the preview). Emit an audit line per new homeroom.
- If `spaceNumber` doesn't yet exist as a Space → upsert. Same as
  single-student flow.

### Plan gating + usage counting

- Available on all plans per queue. Do **not** add a CAMPUS gate.
- Before the preview, call `countOrgUsage` + compute the delta the
  import would produce (new students, new families, new classrooms).
  Run `assertUsageAllowsIncrement` with the totals. If it throws
  `PlanLimitError`, surface the human message on the preview page and
  disable the CTA.
- On commit, re-run the count + `syncUsageGracePeriod` after the
  transaction closes.

### Rate limiting

Add a new binding `RL_IMPORT` (namespace ID `1003`) to
`wrangler.jsonc` — **5 req / 60 s**, keyed on `import:<orgId>`. Touch
`docs/rate-limiting.md` with a new row in the binding table so the
doc stays in sync.

### File + dependency list

| File | Change |
|---|---|
| `app/routes.ts` | add `route("roster-import", …)` inside the admin block |
| `app/routes/admin/roster-import.tsx` | new — loader + action + UI |
| `app/routes/admin/roster-template.csv.ts` | new — returns CSV headers |
| `app/components/admin/RosterImportPreview.tsx` | new — preview table |
| `app/components/admin/AdminSidebar.tsx` | insert nav item (icon `Upload` from `lucide-react`) between "Children & Classes" and "Drills" |
| `app/domain/roster/parse-roster-file.server.ts` | new |
| `app/domain/roster/apply-roster-import.server.ts` | new |
| `wrangler.jsonc` | add `RL_IMPORT` binding entry |
| `docs/rate-limiting.md` | document the new binding |
| `package.json` | add `papaparse` (CSV) + `xlsx` or `read-excel-file` (XLSX) |

### Dependency decision — CSV and XLSX libraries

- **CSV:** `papaparse@^5.4.1`. It's zero-dependency, tiny (~45 KB
  minified), streams by default, handles quoted fields / escaped
  newlines, and has a server-side mode (`Papa.parse(string, {…})`
  without a worker). Alternative `csv-parse` is also fine but
  larger and has more runtime deps.
- **XLSX:** `xlsx@^0.18.5` from SheetJS (community edition). Node
  compatible, bundles a ~500 KB worker-compatible build. The `xlsx`
  SSF/numFmt features we do NOT need — stick to `XLSX.read(buffer,
  {type:'buffer'})` + `XLSX.utils.sheet_to_json(sheet, {header:1})`
  which returns array-of-arrays and dodges Excel's column-type
  coercion weirdness.
  - **Cloudflare Workers compat caveat:** `xlsx` depends on `fs` and
    `stream` only in its CLI paths. The `xlsx/xlsx.mjs` entry works
    on Workers if we import that subpath explicitly
    (`import * as XLSX from "xlsx/xlsx.mjs"`). Confirm with a
    `wrangler dev` + smoke test before merge.
  - **If xlsx breaks under Workers:** fall back to
    `read-excel-file` (~30 KB, Workers-friendly) and restrict XLSX
    support to the first sheet only.

### Data model

No schema changes. If a future iteration wants `grade` and
`guardianEmail` on the student, that's a separate migration — this
spec deliberately punts on it to keep scope tight.

## Testing approach

### Unit tests

- `app/domain/roster/parse-roster-file.server.test.ts`:
  - happy-path CSV (5 rows, 2 columns, ascii + unicode name)
  - happy-path XLSX (round-trip via `xlsx.write` → parse)
  - Windows line endings (`\r\n`), BOM prefix, Excel-exported CSV
    with semicolon delimiter (we should sniff `;` too — test confirms
    what happens today)
  - blank `firstName` → error row
  - duplicate row (same triple appears twice in file) → report as
    one import, count the second as a DUP-SKIP
  - file missing required columns → returns a top-level
    `fileError: "Missing required columns: firstName"` and zero rows

- `app/domain/roster/apply-roster-import.server.test.ts` (uses the
  test Prisma pattern per `docs/multi-tenant-prisma-extension.md`):
  - first-time insert creates student + teacher + space
  - second import of the same row → UPDATE, no new rows
  - plan limit exceeded → throws `PlanLimitError`, transaction
    rolls back (assert row counts unchanged)
  - two rows share a new homeroom → Teacher created once, not twice
  - concurrent-safe dedupe: call twice with the same file, assert
    idempotent (second run = all UPDATE, zero new)

### E2E tests (Playwright)

- `e2e/flows/roster-import.spec.ts`:
  1. Log in as the seeded admin (same fixture 0d introduces in
     `e2e/fixtures/seeded-tenant.ts`).
  2. Navigate `/admin/roster-import`.
  3. Assert "Download template" link 200s and contains the header
     row.
  4. Upload a tiny 3-row CSV fixture. Assert preview renders
     3 NEW rows. Confirm. Assert redirect to `/admin/children`
     with toast "Imported 3 new students".
  5. Re-upload the same CSV. Assert preview shows 3 UPDATE rows
     and zero NEW.
  6. Upload a 1-row CSV with blank firstName. Assert preview shows
     1 ERROR row and the CTA is disabled.

### Staging smoke

A `e2e/smoke.spec.ts` addition: anonymous request to
`/admin/roster-template.csv` should 302 to `/login` (because the
admin layout gates it). Authed request should 200 and start with
`firstName,lastName,homeRoom\n`. One-liner; keeps smoke sweep honest.

## Open questions

1. **Schema: should we add `grade` and `guardianEmail` in this PR
   instead of punting?** The queue lists them as optional columns,
   which implies they should persist. Recommendation: punt in the
   first PR (scope-control) and land them in a follow-up migration.
   Noah decides.
2. **Teacher auto-creation:** is it safe to create homerooms from
   the import without admin review? Today, creating a Teacher also
   requires the user to visit `/create/homeroom`, which presumably
   has its own plan-limit check (`classrooms` count). The import
   flow should run `assertUsageAllowsIncrement` with the full
   delta (students + families + new classrooms) up front. Flag for
   build agent: **must** pass `classrooms: newHomerooms.length` to
   the assertion, not just `students: rows.length`.
3. **Household assignment:** the queue says nothing about
   `householdId`. Siblings share a household in the current model,
   and `familiesDeltaForNewStudent` expects a `householdId`. Every
   imported student in a single run will count as +1 family, which
   will blow through the family cap for a real school roster
   (400 students ≠ 400 families). **Recommendation:** pre-group rows
   by `(lastName, guardianEmail)` and create/upsert households per
   group before upserting students. If that's too much for one PR,
   document the limitation in the success message — "You've used
   {N} of your {family-cap} family slots. Group siblings by editing
   students after import."
4. **File size ceiling:** worker POST body limit is 100 MB, but D1
   transaction scope is capped around 50 k statements. A 10 k-row
   import would break it. Recommendation: reject any file > 2,000
   rows at parse time with a helpful error ("Split your file into
   smaller imports — max 2,000 students per file"). Noah can raise
   the cap later when we have batch-chunking.
5. **Undo / rollback:** should there be an "undo last import"
   button? Not for PR 1. But the audit log entry should include
   enough info (list of created IDs) to build that later.
6. **XLSX multiple sheets:** if the file has multiple sheets, we
   use the first sheet only. Confirm this matches Noah's intuition
   — some schools keep "students" and "staff" in one workbook.

## Out of scope (explicit)

- Teacher / staff CSV import (separate future workstream).
- Guardian / family CSV import.
- CSV **export** — already available on `/admin/history` per the
  queue note.
- "Undo last import" UI.
- Dry-run-only mode separate from the preview pane (the preview IS
  the dry run).
- Any queue / background-job handoff. This is synchronous in the
  request path; 400 rows on D1 is within worker CPU budget.
