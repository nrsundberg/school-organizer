-- Migration number: 0036 	 2026-04-28T00:00:00.000Z
--
-- Soft-delete for DrillTemplate. Hard-deleting a template took its
-- historical DrillRun + DrillRunEvent rows with it (FK ON DELETE CASCADE),
-- which is unacceptable for compliance: drill records are how schools
-- prove to inspectors that they ran the required cadence. Soft-delete
-- preserves the trail; the admin UI filters out archived templates from
-- the picker but the run history stays visible.

ALTER TABLE "DrillTemplate" ADD COLUMN "deletedAt" DATETIME;

CREATE INDEX "DrillTemplate_orgId_deletedAt_idx" ON "DrillTemplate"("orgId", "deletedAt");
