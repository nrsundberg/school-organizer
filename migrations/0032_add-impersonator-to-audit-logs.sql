-- Migration number: 0032 	 2026-04-28T11:11:28.924Z
--
-- Audit-trail: capture the impersonated user on org/district audit-log rows.
-- See plans/on-https-lincoln-example-pickuproster-co-staged-crescent.md (W1c).
--
-- OrgAuditLog and DistrictAuditLog already record `actorUserId` (the human who
-- clicked, i.e. the admin's id when impersonating). To match the existing
-- CallEvent / DrillRun audit pair, we add `onBehalfOfUserId`: non-null only
-- when the action was performed via impersonation.
--
-- Both columns are nullable. No backfill — pre-existing rows stay null.

ALTER TABLE "OrgAuditLog"      ADD COLUMN "onBehalfOfUserId" TEXT;
ALTER TABLE "DistrictAuditLog" ADD COLUMN "onBehalfOfUserId" TEXT;
