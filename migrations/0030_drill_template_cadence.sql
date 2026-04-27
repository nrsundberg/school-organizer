-- Required-per-year cadence on DrillTemplate. Drives the "next due / overdue"
-- pill on the admin drills list. NFPA 101 requires monthly K-12 fire drills
-- (12/yr); most state DOEs require N lockdown drills/yr — but N is jurisdiction-
-- specific, so we leave the column NULL by default and let admins set it per
-- template. Null → no cadence tracking, no pill on the list.
--
-- Threshold logic lives in app/domain/drills/cadence.ts and only reads the
-- most recent ENDED DrillRun for the template; this migration is purely a
-- schema add. Backfill is implicit (NULL) — historical templates keep today's
-- behavior until an admin opts in.

ALTER TABLE "DrillTemplate"
  ADD COLUMN "requiredPerYear" INTEGER;
