-- Platform-level daily counters for the help chat. Not tenant data: no orgId.
-- The Workers rate-limit binding only supports a 10s or 60s window.

CREATE TABLE IF NOT EXISTS "HelpChatQuota" (
  "subject" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("subject", "day")
);
