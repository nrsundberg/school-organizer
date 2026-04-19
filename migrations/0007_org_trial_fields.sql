-- Org trial tracking (calendar + qualifying pickup days)
ALTER TABLE "Org" ADD COLUMN "trialStartedAt" DATETIME;
ALTER TABLE "Org" ADD COLUMN "trialQualifyingPickupDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Org" ADD COLUMN "trialEndsAt" DATETIME;
