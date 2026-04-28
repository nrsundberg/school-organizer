-- Migration number: 0035 	 2026-04-28T00:00:00.000Z
--
-- Move the car-line/pickup space number from Student to Household. Siblings
-- in one household always share a single space, so the family is the natural
-- owner of the field. Backfill copies any existing per-student value into
-- the parent household (taking the first non-null value when siblings
-- happen to disagree).
--
-- Implementation note: SQLite/D1 supports ALTER TABLE DROP COLUMN, but the
-- existing Student.spaceNumber column participates in a composite FK to
-- Space(orgId, spaceNumber) declared inline at CREATE TABLE time. Dropping
-- a column that's part of an FK requires recreating the table, which is
-- noisy. We leave the orphan column on Student in place — Prisma is the
-- only reader and we've removed the field from the model, so application
-- code no longer touches it. A future migration can rebuild the Student
-- table to remove the column and indexes if desired.

ALTER TABLE "Household" ADD COLUMN "spaceNumber" INTEGER;

-- Backfill: take the first non-null space number among the household's
-- students. If every sibling has the same value (the expected case after
-- this migration ships) the result is deterministic; if they disagree
-- (legacy data), one of them wins — the household form is now the source
-- of truth for any future edits.
UPDATE "Household"
SET "spaceNumber" = (
  SELECT s."spaceNumber"
  FROM "Student" s
  WHERE s."householdId" = "Household".id
    AND s."spaceNumber" IS NOT NULL
  LIMIT 1
)
WHERE "spaceNumber" IS NULL;

CREATE INDEX "Household_spaceNumber_idx" ON "Household"("spaceNumber");
CREATE INDEX "Household_orgId_spaceNumber_idx" ON "Household"("orgId", "spaceNumber");
