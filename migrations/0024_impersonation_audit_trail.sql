-- Migration number: 0024 	 2026-04-25
--
-- Audit-trail columns for impersonation context. See
-- docs/superpowers/plans/2026-04-25-impersonation-audit-trail.md.
--
-- CallEvent: who actually clicked (admin if impersonating), and who they
--   were impersonating (null outside impersonation).
-- DrillRun: same pair for the most recent state-machine action.
--
-- All columns nullable. Existing rows stay null — pre-2026-04-25 events
-- have no recorded actor. New rows always set actorUserId when a session
-- exists; the public viewer (anonymous) board still produces actorUserId
-- = NULL, which is the intended distinction.

ALTER TABLE "CallEvent" ADD COLUMN "actorUserId" TEXT;
ALTER TABLE "CallEvent" ADD COLUMN "onBehalfOfUserId" TEXT;
CREATE INDEX "CallEvent_orgId_onBehalfOfUserId_idx"
  ON "CallEvent" ("orgId", "onBehalfOfUserId");

ALTER TABLE "DrillRun" ADD COLUMN "lastActorUserId" TEXT;
ALTER TABLE "DrillRun" ADD COLUMN "lastActorOnBehalfOfUserId" TEXT;
