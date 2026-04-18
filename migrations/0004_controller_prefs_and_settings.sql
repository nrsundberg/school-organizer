-- Rename legacy role to CONTROLLER
UPDATE "User" SET role = 'CONTROLLER' WHERE role = 'CALLER';

-- User preference for controller default tab (board vs keypad)
ALTER TABLE "User" ADD COLUMN "controllerViewPreference" TEXT;

CREATE TABLE IF NOT EXISTS "AppSettings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "viewerDrawingEnabled" INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO "AppSettings" ("id", "viewerDrawingEnabled") VALUES ('default', 0);
