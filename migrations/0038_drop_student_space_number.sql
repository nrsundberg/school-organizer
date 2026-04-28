-- Migration number: 0038 	 2026-04-28T17:00:00.000Z
--
-- Drop the now-unused `Student.spaceNumber` column (and its two indexes
-- and FK to Space). Migration 0035 moved car-line numbers onto Household
-- but left this column in place because dropping a column that
-- participates in a composite FK requires recreating the table — this
-- migration does the rebuild.
--
-- D1 wraps each migration in an implicit transaction; `PRAGMA
-- foreign_keys` cannot toggle inside one, so we use `PRAGMA
-- defer_foreign_keys = on` (per Cloudflare D1's foreign-keys docs) which
-- defers FK enforcement to commit time. CallEvent.studentId and
-- DismissalException.studentId reference Student(id); the rebuild
-- preserves every row's id, so the deferred FK check passes when the
-- transaction commits.

PRAGMA defer_foreign_keys = on;

-- New shape: same columns minus `spaceNumber`, same FK to Teacher,
-- no FK to Space.
CREATE TABLE "Student_new" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "orgId" TEXT NOT NULL DEFAULT 'org_tome',
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "homeRoom" TEXT,
  "householdId" TEXT,
  FOREIGN KEY ("orgId", "homeRoom") REFERENCES "Teacher"("orgId", "homeRoom") ON DELETE SET NULL
);

INSERT INTO "Student_new" ("id", "orgId", "firstName", "lastName", "homeRoom", "householdId")
SELECT "id", "orgId", "firstName", "lastName", "homeRoom", "householdId" FROM "Student";

DROP TABLE "Student";
ALTER TABLE "Student_new" RENAME TO "Student";

-- Recreate the indexes that survive the column drop. The two spaceNumber
-- indexes (`Student_spaceNumber_idx`, `Student_orgId_spaceNumber_idx`)
-- are intentionally not recreated.
CREATE INDEX "Student_orgId_idx" ON "Student"("orgId");
CREATE INDEX "Student_homeRoom_idx" ON "Student"("homeRoom");
CREATE INDEX "Student_orgId_householdId_idx" ON "Student"("orgId", "householdId");
CREATE INDEX "Student_orgId_homeRoom_idx" ON "Student"("orgId", "homeRoom");
