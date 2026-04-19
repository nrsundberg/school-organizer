-- Past-due grace tracking, manual comp fields, SUSPENDED org status (stored as TEXT on SQLite)
ALTER TABLE "Org" ADD COLUMN "pastDueSinceAt" DATETIME;
ALTER TABLE "Org" ADD COLUMN "billingNote" TEXT;
ALTER TABLE "Org" ADD COLUMN "compedUntil" DATETIME;
