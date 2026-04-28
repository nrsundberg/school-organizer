-- Migration number: 0037 	 2026-04-28T12:00:00.000Z
--
-- Admin dashboard "Was the board reset today?" indicator: persist a
-- timestamp on AppSettings whenever the dashboard's `clear` action runs.
-- The dashboard reads it back and surfaces either "Reset 7:32am" or
-- "Not yet reset today" as a stat card so admins can tell at a glance
-- whether yesterday's state has been wiped before the morning bell.
--
-- Nullable so (a) existing orgs don't fail the migration and (b) the
-- dashboard can render the "Not yet reset" affordance for orgs that
-- have never run the action.

ALTER TABLE "AppSettings" ADD COLUMN "lastBoardResetAt" DATETIME;
