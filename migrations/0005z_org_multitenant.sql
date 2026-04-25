-- Multi-tenant foundation: Org table + StripeWebhookEvent + default org seed.
-- Tenant tables already carry orgId from migration 0000+ (the orgId columns
-- and composite uniqueness were baked into table creation), so this file
-- only needs to introduce the Org model and seed the legacy "org_tome" row
-- that existing rows default to.
--
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

-- User.orgId was added by better-auth migrations elsewhere; keep this
-- backfill so any pre-existing User rows on a long-lived DB pick up the
-- default org. Idempotent.
ALTER TABLE "User" ADD COLUMN "orgId" TEXT;
CREATE INDEX IF NOT EXISTS "User_orgId_idx" ON "User"("orgId");
UPDATE "User" SET "orgId" = 'org_tome' WHERE "orgId" IS NULL;
