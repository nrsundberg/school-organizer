-- Per-action audit log for a DrillRun. One row per discrete user action so
-- the drill replay UI on /admin/drills/history/:runId can reconstruct any
-- intermediate state by folding events forward from the run's initial state.
CREATE TABLE "DrillRunEvent" (
    "id"               TEXT     NOT NULL PRIMARY KEY,
    "runId"            TEXT     NOT NULL,
    "kind"             TEXT     NOT NULL,
    "payload"          TEXT     NOT NULL,
    "actorUserId"      TEXT,
    "onBehalfOfUserId" TEXT,
    "occurredAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DrillRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DrillRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DrillRunEvent_runId_occurredAt_idx" ON "DrillRunEvent"("runId", "occurredAt");
