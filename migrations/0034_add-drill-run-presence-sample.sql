-- Migration number: 0034 	 2026-04-28T11:11:35.735Z
--
-- Live "who's watching" replay support: the drill-run Durable Object
-- snapshots its presence roster every 30s while a run is LIVE/PAUSED so the
-- replay UI can show who was watching at any point on the timeline.
-- See plans/on-https-lincoln-example-pickuproster-co-staged-crescent.md (W4a).
--
-- Bounded write volume: ~120 rows for an hour-long drill regardless of
-- viewer count. `viewers` is JSON-encoded:
--   Array<{ userId, label, onBehalfOfUserId, onBehalfOfLabel, isGuest, color }>

CREATE TABLE "DrillRunPresenceSample" (
    "id"         TEXT     NOT NULL PRIMARY KEY,
    "runId"      TEXT     NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewers"    TEXT     NOT NULL,
    "guestCount" INTEGER  NOT NULL DEFAULT 0,
    CONSTRAINT "DrillRunPresenceSample_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DrillRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DrillRunPresenceSample_runId_occurredAt_idx" ON "DrillRunPresenceSample"("runId", "occurredAt");
