-- Drill mode + responsible-party sign-off.
--
-- mode (DRILL | ACTUAL | FALSE_ALARM):
--   "DRILL"        → planned exercise (the default; matches today's behavior).
--   "ACTUAL"       → real emergency captured in the same UI. State DOEs
--                    typically want this distinction for compliance reporting.
--   "FALSE_ALARM"  → real alert that turned out to be unfounded.
-- Backfill is "DRILL" for existing rows so historical archives keep their
-- prior semantics (everything before this column was, by definition, a drill).
--
-- signedOffByUserId / signedOffAt:
--   Optional principal sign-off attesting the drill happened. Stored as a
--   plain string (no FK to User) so historical rows aren't blocked by user
--   deletes or cross-tenant moves. Pair is always written together by the
--   sign-off action; never one without the other.
--
-- This migration is additive only — capture & display. No destructive action
-- is yet gated on `mode = ACTUAL`; that's a planned follow-up.

ALTER TABLE "DrillRun"
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'DRILL';

ALTER TABLE "DrillRun"
  ADD COLUMN "signedOffByUserId" TEXT;

ALTER TABLE "DrillRun"
  ADD COLUMN "signedOffAt" DATETIME;
