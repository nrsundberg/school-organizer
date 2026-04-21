-- Status page: probe result history + incident tracking.
--
-- StatusCheck captures every probe result (one row per component per tick).
-- StatusIncident is derived state — opened after 3 consecutive non-operational
-- results, closed after 2 consecutive operational results. See
-- app/domain/status/runner.server.ts for the state machine.

CREATE TABLE "StatusCheck" (
  "id"          TEXT PRIMARY KEY NOT NULL,
  "componentId" TEXT NOT NULL,
  "status"      TEXT NOT NULL,           -- 'operational' | 'degraded' | 'outage' | 'unknown'
  "latencyMs"   INTEGER,
  "detail"      TEXT,
  "checkedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StatusCheck_component_checkedAt_idx"
  ON "StatusCheck"("componentId", "checkedAt" DESC);
CREATE INDEX "StatusCheck_checkedAt_idx" ON "StatusCheck"("checkedAt");

CREATE TABLE "StatusIncident" (
  "id"          TEXT PRIMARY KEY NOT NULL,
  "componentId" TEXT NOT NULL,
  "severity"    TEXT NOT NULL,           -- 'degraded' | 'outage'
  "title"       TEXT NOT NULL,
  "startedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"  DATETIME,
  "lastFailAt"  DATETIME,
  "source"      TEXT NOT NULL DEFAULT 'auto'
);
CREATE INDEX "StatusIncident_open_idx"
  ON "StatusIncident"("componentId") WHERE "resolvedAt" IS NULL;
CREATE INDEX "StatusIncident_startedAt_idx" ON "StatusIncident"("startedAt" DESC);
