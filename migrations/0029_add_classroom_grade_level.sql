-- Add grade-level + advisory capacity + display teacher name to Teacher
-- (= "classroom" in this codebase). Backfill is intentionally NOT performed:
-- the children admin UI surfaces an inline "Ungraded — set grade" prompt
-- for any classroom whose gradeLevel is null. Capacity is advisory; the
-- progress bar in the UI defaults to 22 when capacity is null.
ALTER TABLE "Teacher" ADD COLUMN "gradeLevel" TEXT;
ALTER TABLE "Teacher" ADD COLUMN "capacity" INTEGER;
ALTER TABLE "Teacher" ADD COLUMN "teacherName" TEXT;

-- Tab/pill filtering on the index groups by grade and orgId. D1 is happy
-- with composite indexes; without one, the GROUP-BY-grade grouping does a
-- full scan of all classrooms once an org has more than a few dozen rooms.
CREATE INDEX "Teacher_orgId_gradeLevel_idx" ON "Teacher"("orgId", "gradeLevel");
