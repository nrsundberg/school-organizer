-- Plan usage: grace period + optional household grouping for family counts
ALTER TABLE "Org" ADD COLUMN "usageGraceStartedAt" DATETIME;

ALTER TABLE "Student" ADD COLUMN "householdId" TEXT;

CREATE INDEX IF NOT EXISTS "Student_orgId_householdId_idx" ON "Student"("orgId", "householdId");

-- Legacy Stripe plan name → Campus tier limits
UPDATE "Org" SET "billingPlan" = 'CAMPUS' WHERE "billingPlan" = 'STARTER';
