-- Migration number: 0042 	 2026-06-25T00:00:00.000Z
-- Enrich OrgAuditLog so general admin mutations (branding, students, households,
-- users, settings, ...) carry CloudTrail-style detail: who (email snapshot),
-- from where (IP + user agent), and what entity was touched (targetType/Id).
-- The before/after diff itself rides in the existing JSON `payload` column.
-- All columns are nullable, so existing rows need no backfill.
ALTER TABLE "OrgAuditLog" ADD COLUMN "actorEmail" TEXT;
ALTER TABLE "OrgAuditLog" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "OrgAuditLog" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "OrgAuditLog" ADD COLUMN "targetType" TEXT;
ALTER TABLE "OrgAuditLog" ADD COLUMN "targetId" TEXT;

-- Lets the platform views filter an org's log by action type without a full scan.
CREATE INDEX "OrgAuditLog_orgId_action_idx" ON "OrgAuditLog"("orgId", "action");
