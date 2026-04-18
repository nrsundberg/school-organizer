ALTER TABLE "AppSettings" ADD COLUMN "viewerPinHash" TEXT;

CREATE TABLE IF NOT EXISTS "ViewerAccessAttempt" (
  "clientKey" TEXT NOT NULL PRIMARY KEY,
  "ipHint" TEXT,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "stage" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" DATETIME,
  "requiresAdminReset" INTEGER NOT NULL DEFAULT 0,
  "lastFailedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ViewerAccessSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ViewerAccessSession_tokenHash_key"
  ON "ViewerAccessSession"("tokenHash");

CREATE TABLE IF NOT EXISTS "ViewerMagicLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "revokedAt" DATETIME,
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ViewerMagicLink_tokenHash_key"
  ON "ViewerMagicLink"("tokenHash");

INSERT OR IGNORE INTO "AppSettings" ("id", "viewerDrawingEnabled") VALUES ('default', 0);
