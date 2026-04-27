-- Audience for live drills. Two tiers:
--   STAFF_ONLY  → only staff (signed-in User rows) see the takeover; viewer-pin
--                 guests continue to see the normal board.
--   EVERYONE    → staff + viewer-pin guests see the takeover.
--
-- DrillTemplate.defaultAudience is the default pre-selected when an admin starts
-- a live drill from the template. DrillRun.audience is the frozen choice for
-- this run; admins cannot change it mid-run (would orphan or pull in viewers
-- mid-event). Both backfill to 'EVERYONE' so historical runs keep today's
-- behavior (no audience scoping existed before this migration).

ALTER TABLE "DrillTemplate"
  ADD COLUMN "defaultAudience" TEXT NOT NULL DEFAULT 'EVERYONE';

ALTER TABLE "DrillRun"
  ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'EVERYONE';
