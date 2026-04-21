-- Add `isComped` boolean to Org.
--
-- Comped orgs (marked by staff from the platform admin panel) bypass all
-- billing enforcement — they behave like perpetually-ACTIVE orgs regardless
-- of trial expiry or subscription status. The existing `compedUntil` column
-- is a time-bounded comp used for temporary exemptions; `isComped` is a
-- hard-on switch used by staff to fully grant a free account.

ALTER TABLE "Org" ADD COLUMN "isComped" INTEGER NOT NULL DEFAULT 0;
