-- Migration number: 0033 	 2026-04-28T11:11:35.184Z
--
-- Forensic depth: capture the originating IP and user-agent on audit-grade
-- event tables. See plans/on-https-lincoln-example-pickuproster-co-staged-
-- crescent.md (W2a).
--
-- D1 is encrypted at rest by Cloudflare; no app-level encryption. No
-- retention-policy change in this migration.
--
-- All columns nullable. No backfill — pre-existing rows stay null because
-- the data was never captured.

ALTER TABLE "DrillRunEvent" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "DrillRunEvent" ADD COLUMN "userAgent" TEXT;

ALTER TABLE "CallEvent"     ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "CallEvent"     ADD COLUMN "userAgent" TEXT;
