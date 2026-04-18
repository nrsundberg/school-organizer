CREATE TABLE IF NOT EXISTS "CallEvent" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "spaceNumber" INTEGER NOT NULL,
  "studentId" INTEGER,
  "studentName" TEXT NOT NULL,
  "homeRoomSnapshot" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("spaceNumber") REFERENCES "Space"("spaceNumber") ON DELETE RESTRICT,
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "CallEvent_createdAt_idx" ON "CallEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "CallEvent_spaceNumber_idx" ON "CallEvent"("spaceNumber");
CREATE INDEX IF NOT EXISTS "CallEvent_studentId_idx" ON "CallEvent"("studentId");
