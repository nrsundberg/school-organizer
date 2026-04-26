CREATE TABLE IF NOT EXISTS "CallEvent" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "orgId" TEXT NOT NULL DEFAULT 'org_tome',
  "spaceNumber" INTEGER NOT NULL,
  "studentId" INTEGER,
  "studentName" TEXT NOT NULL,
  "homeRoomSnapshot" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("orgId", "spaceNumber") REFERENCES "Space"("orgId", "spaceNumber") ON DELETE RESTRICT,
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "CallEvent_orgId_idx" ON "CallEvent"("orgId");
CREATE INDEX IF NOT EXISTS "CallEvent_createdAt_idx" ON "CallEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "CallEvent_spaceNumber_idx" ON "CallEvent"("spaceNumber");
CREATE INDEX IF NOT EXISTS "CallEvent_studentId_idx" ON "CallEvent"("studentId");
CREATE INDEX IF NOT EXISTS "CallEvent_orgId_createdAt_idx" ON "CallEvent"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "CallEvent_orgId_spaceNumber_idx" ON "CallEvent"("orgId", "spaceNumber");
CREATE INDEX IF NOT EXISTS "CallEvent_orgId_studentId_idx" ON "CallEvent"("orgId", "studentId");
