-- Multi-tenant foundation: Org + orgId on tenant tables.
-- Earlier SQL migrations (0000–0005) predate the Org model; 0006+ assume "Org" exists.
-- This file is named 0005z_* so it runs after 0005_viewer_access_controls.sql.

CREATE TABLE IF NOT EXISTS "Org" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "customDomain" TEXT UNIQUE,
  "brandColor" TEXT,
  "logoUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "stripeCustomerId" TEXT UNIQUE,
  "stripeSubscriptionId" TEXT UNIQUE,
  "billingPlan" TEXT NOT NULL DEFAULT 'FREE',
  "subscriptionStatus" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "Org_slug_key" ON "Org"("slug");

INSERT OR IGNORE INTO "Org" ("id", "name", "slug", "status", "billingPlan", "createdAt", "updatedAt")
VALUES ('org_tome', 'Tome', 'tome', 'ACTIVE', 'FREE', datetime('now'), datetime('now'));

CREATE TABLE IF NOT EXISTS "StripeWebhookEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "stripeEventId" TEXT NOT NULL UNIQUE,
  "type" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Tenant-scoped tables: add orgId (default existing rows to org_tome)
ALTER TABLE "User" ADD COLUMN "orgId" TEXT;
CREATE INDEX IF NOT EXISTS "User_orgId_idx" ON "User"("orgId");
UPDATE "User" SET "orgId" = 'org_tome' WHERE "orgId" IS NULL;

ALTER TABLE "Teacher" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT 'org_tome';
CREATE INDEX IF NOT EXISTS "Teacher_orgId_idx" ON "Teacher"("orgId");
CREATE INDEX IF NOT EXISTS "Teacher_orgId_homeRoom_idx" ON "Teacher"("orgId", "homeRoom");

ALTER TABLE "Student" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT 'org_tome';
CREATE INDEX IF NOT EXISTS "Student_orgId_idx" ON "Student"("orgId");
CREATE INDEX IF NOT EXISTS "Student_orgId_spaceNumber_idx" ON "Student"("orgId", "spaceNumber");
CREATE INDEX IF NOT EXISTS "Student_orgId_homeRoom_idx" ON "Student"("orgId", "homeRoom");

ALTER TABLE "Space" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT 'org_tome';
CREATE INDEX IF NOT EXISTS "Space_orgId_idx" ON "Space"("orgId");
CREATE INDEX IF NOT EXISTS "Space_orgId_spaceNumber_idx" ON "Space"("orgId", "spaceNumber");

ALTER TABLE "CallEvent" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT 'org_tome';
CREATE INDEX IF NOT EXISTS "CallEvent_orgId_idx" ON "CallEvent"("orgId");
CREATE INDEX IF NOT EXISTS "CallEvent_orgId_createdAt_idx" ON "CallEvent"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "CallEvent_orgId_spaceNumber_idx" ON "CallEvent"("orgId", "spaceNumber");
CREATE INDEX IF NOT EXISTS "CallEvent_orgId_studentId_idx" ON "CallEvent"("orgId", "studentId");

ALTER TABLE "AppSettings" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT 'org_tome';
CREATE INDEX IF NOT EXISTS "AppSettings_orgId_idx" ON "AppSettings"("orgId");
UPDATE "AppSettings" SET "orgId" = 'org_tome' WHERE "orgId" IS NULL OR "orgId" = '';

ALTER TABLE "ViewerAccessAttempt" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT 'org_tome';
CREATE INDEX IF NOT EXISTS "ViewerAccessAttempt_orgId_idx" ON "ViewerAccessAttempt"("orgId");
UPDATE "ViewerAccessAttempt" SET "orgId" = 'org_tome' WHERE "orgId" IS NULL OR "orgId" = '';

ALTER TABLE "ViewerAccessSession" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT 'org_tome';
CREATE INDEX IF NOT EXISTS "ViewerAccessSession_orgId_idx" ON "ViewerAccessSession"("orgId");
UPDATE "ViewerAccessSession" SET "orgId" = 'org_tome' WHERE "orgId" IS NULL OR "orgId" = '';

ALTER TABLE "ViewerMagicLink" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT 'org_tome';
CREATE INDEX IF NOT EXISTS "ViewerMagicLink_orgId_idx" ON "ViewerMagicLink"("orgId");
UPDATE "ViewerMagicLink" SET "orgId" = 'org_tome' WHERE "orgId" IS NULL OR "orgId" = '';
