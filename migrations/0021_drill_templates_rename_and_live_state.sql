-- Rename FireDrillTemplate → DrillTemplate, FireDrillRun → DrillRun.
-- Add drillType, authority, instructions, globalKey to templates.
-- Add status state machine (DRAFT | LIVE | PAUSED | ENDED) + activatedAt/pausedAt/endedAt to runs.
-- Drop the unique-on-templateId constraint (allow run history; multiple runs per template).
-- Enforce "at most one LIVE/PAUSED drill per org" with a partial unique index (D1/SQLite >= 3.8.0).

-- ============================================================================
-- DrillTemplate (rename + add columns)
-- ============================================================================
ALTER TABLE "FireDrillTemplate" RENAME TO "DrillTemplate";

DROP INDEX IF EXISTS "FireDrillTemplate_orgId_idx";
CREATE INDEX "DrillTemplate_orgId_idx" ON "DrillTemplate"("orgId");

ALTER TABLE "DrillTemplate" ADD COLUMN "drillType"    TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE "DrillTemplate" ADD COLUMN "authority"    TEXT;
ALTER TABLE "DrillTemplate" ADD COLUMN "instructions" TEXT;
ALTER TABLE "DrillTemplate" ADD COLUMN "globalKey"    TEXT;

CREATE INDEX "DrillTemplate_globalKey_idx" ON "DrillTemplate"("globalKey");

-- ============================================================================
-- DrillRun (rebuild: drop unique constraint, add status fields, backfill)
-- ============================================================================
CREATE TABLE "DrillRun" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "orgId"       TEXT     NOT NULL,
    "templateId"  TEXT     NOT NULL,
    "state"       TEXT     NOT NULL,
    "status"      TEXT     NOT NULL DEFAULT 'ENDED',
    "activatedAt" DATETIME,
    "pausedAt"    DATETIME,
    "endedAt"     DATETIME,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL,
    CONSTRAINT "DrillRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DrillRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DrillTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Backfill: existing rows are historical; mark ENDED with endedAt = updatedAt.
INSERT INTO "DrillRun" (id, orgId, templateId, state, status, endedAt, createdAt, updatedAt)
SELECT id, orgId, templateId, state, 'ENDED', updatedAt, createdAt, updatedAt
FROM "FireDrillRun";

DROP TABLE "FireDrillRun";

CREATE INDEX "DrillRun_orgId_idx"      ON "DrillRun"("orgId");
CREATE INDEX "DrillRun_templateId_idx" ON "DrillRun"("templateId");

-- Concurrency invariant: at most one active drill per org.
-- Enforced atomically by SQLite; app code catches the unique-violation as 409.
CREATE UNIQUE INDEX "DrillRun_one_active_per_org_idx"
ON "DrillRun"("orgId")
WHERE "status" IN ('LIVE', 'PAUSED');
