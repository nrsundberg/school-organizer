ALTER TABLE "AppSettings" ADD COLUMN "viewerPinHash" TEXT;

-- ViewerAccessAttempt is rate-limit / lockout state per (org, fingerprint).
-- Composite PK ensures the same browser fingerprint visiting two tenant
-- subdomains gets independent attempt counters.
CREATE TABLE IF NOT EXISTS "ViewerAccessAttempt" (
  "orgId" TEXT NOT NULL DEFAULT 'org_tome',
  "clientKey" TEXT NOT NULL,
  "ipHint" TEXT,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "stage" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" DATETIME,
  "requiresAdminReset" INTEGER NOT NULL DEFAULT 0,
  "lastFailedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("orgId", "clientKey")
);

CREATE INDEX IF NOT EXISTS "ViewerAccessAttempt_orgId_idx" ON "ViewerAccessAttempt"("orgId");

CREATE TABLE IF NOT EXISTS "ViewerAccessSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orgId" TEXT NOT NULL DEFAULT 'org_tome',
  "tokenHash" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ViewerAccessSession_orgId_tokenHash_key"
  ON "ViewerAccessSession"("orgId", "tokenHash");
CREATE INDEX IF NOT EXISTS "ViewerAccessSession_orgId_idx" ON "ViewerAccessSession"("orgId");

CREATE TABLE IF NOT EXISTS "ViewerMagicLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orgId" TEXT NOT NULL DEFAULT 'org_tome',
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "revokedAt" DATETIME,
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ViewerMagicLink_orgId_tokenHash_key"
  ON "ViewerMagicLink"("orgId", "tokenHash");
CREATE INDEX IF NOT EXISTS "ViewerMagicLink_orgId_idx" ON "ViewerMagicLink"("orgId");
