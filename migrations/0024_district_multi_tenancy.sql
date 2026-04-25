-- Migration number: 0024 	 2026-04-25T23:47:58.787Z

-- District table
CREATE TABLE "District" (
  "id"                     TEXT PRIMARY KEY NOT NULL,
  "name"                   TEXT NOT NULL,
  "slug"                   TEXT NOT NULL,
  "logoUrl"                TEXT,
  "logoObjectKey"          TEXT,
  "status"                 TEXT NOT NULL DEFAULT 'TRIALING',
  "schoolCap"              INTEGER NOT NULL DEFAULT 3,
  "stripeCustomerId"       TEXT,
  "stripeSubscriptionId"   TEXT,
  "subscriptionStatus"     TEXT,
  "billingPlan"            TEXT NOT NULL DEFAULT 'DISTRICT',
  "trialStartedAt"         DATETIME,
  "trialEndsAt"            DATETIME,
  "pastDueSinceAt"         DATETIME,
  "compedUntil"            DATETIME,
  "isComped"               INTEGER NOT NULL DEFAULT 0,
  "billingNote"            TEXT,
  "passwordResetEnabled"   INTEGER NOT NULL DEFAULT 1,
  "defaultLocale"          TEXT NOT NULL DEFAULT 'en',
  "createdAt"              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              DATETIME NOT NULL
);

CREATE UNIQUE INDEX "District_slug_key"             ON "District"("slug");
CREATE UNIQUE INDEX "District_stripeCustomerId_key" ON "District"("stripeCustomerId");
CREATE UNIQUE INDEX "District_stripeSubscriptionId_key" ON "District"("stripeSubscriptionId");

-- DistrictAuditLog table
CREATE TABLE "DistrictAuditLog" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "districtId"   TEXT NOT NULL,
  "actorUserId"  TEXT,
  "actorEmail"   TEXT,
  "action"       TEXT NOT NULL,
  "targetType"   TEXT,
  "targetId"     TEXT,
  "details"      TEXT,
  "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE CASCADE
);

CREATE INDEX "DistrictAuditLog_districtId_createdAt_idx"
  ON "DistrictAuditLog"("districtId", "createdAt");

-- Org.districtId
ALTER TABLE "Org" ADD COLUMN "districtId" TEXT REFERENCES "District"("id") ON DELETE SET NULL;
CREATE INDEX "Org_districtId_idx" ON "Org"("districtId");

-- User.districtId
ALTER TABLE "User" ADD COLUMN "districtId" TEXT REFERENCES "District"("id") ON DELETE SET NULL;
CREATE INDEX "User_districtId_idx" ON "User"("districtId");
