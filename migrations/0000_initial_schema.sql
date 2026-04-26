-- better-auth tables
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL DEFAULT '',
  "image" TEXT,
  "role" TEXT NOT NULL DEFAULT 'VIEWER',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "token" TEXT NOT NULL UNIQUE,
  "expiresAt" DATETIME NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" DATETIME,
  "refreshTokenExpiresAt" DATETIME,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- App domain tables.
-- Tenant tables carry orgId from the start; uniqueness on tenant fields
-- (homeRoom, spaceNumber) is composite with orgId so two orgs can't collide.
-- The actual Org table is created in 0005z; FK enforcement on orgId is
-- intentionally not declared here (D1 would reject TEXT FKs to a not-yet-created
-- table, and tenant scoping is enforced at the application layer via the
-- Prisma tenant extension).
CREATE TABLE IF NOT EXISTS "Teacher" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "orgId" TEXT NOT NULL DEFAULT 'org_tome',
  "homeRoom" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Teacher_orgId_homeRoom_key" ON "Teacher"("orgId", "homeRoom");
CREATE INDEX IF NOT EXISTS "Teacher_orgId_idx" ON "Teacher"("orgId");

CREATE TABLE IF NOT EXISTS "Space" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "orgId" TEXT NOT NULL DEFAULT 'org_tome',
  "spaceNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'EMPTY',
  "timestamp" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "Space_orgId_spaceNumber_key" ON "Space"("orgId", "spaceNumber");
CREATE INDEX IF NOT EXISTS "Space_orgId_idx" ON "Space"("orgId");
CREATE INDEX IF NOT EXISTS "Space_spaceNumber_idx" ON "Space"("spaceNumber");

CREATE TABLE IF NOT EXISTS "Student" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "orgId" TEXT NOT NULL DEFAULT 'org_tome',
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "spaceNumber" INTEGER,
  "homeRoom" TEXT,
  FOREIGN KEY ("orgId", "spaceNumber") REFERENCES "Space"("orgId", "spaceNumber") ON DELETE SET NULL,
  FOREIGN KEY ("orgId", "homeRoom") REFERENCES "Teacher"("orgId", "homeRoom") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "Student_orgId_idx" ON "Student"("orgId");
CREATE INDEX IF NOT EXISTS "Student_spaceNumber_idx" ON "Student"("spaceNumber");
CREATE INDEX IF NOT EXISTS "Student_homeRoom_idx" ON "Student"("homeRoom");
CREATE INDEX IF NOT EXISTS "Student_orgId_spaceNumber_idx" ON "Student"("orgId", "spaceNumber");
CREATE INDEX IF NOT EXISTS "Student_orgId_homeRoom_idx" ON "Student"("orgId", "homeRoom");
