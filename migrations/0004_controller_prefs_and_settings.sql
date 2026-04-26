-- Rename legacy role to CONTROLLER
UPDATE "User" SET role = 'CONTROLLER' WHERE role = 'CALLER';

-- User preference for controller default tab (board vs keypad)
ALTER TABLE "User" ADD COLUMN "controllerViewPreference" TEXT;

-- AppSettings is exactly one row per org. orgId is the primary key; there is
-- no singleton "default" sentinel (that pattern was a single-tenant relic).
-- Rows are created on demand by the application's upsert calls.
CREATE TABLE IF NOT EXISTS "AppSettings" (
  "orgId" TEXT NOT NULL PRIMARY KEY,
  "viewerDrawingEnabled" INTEGER NOT NULL DEFAULT 0
);
