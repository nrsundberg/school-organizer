CREATE TABLE "OrgAuditLog" (
  "id"          TEXT PRIMARY KEY NOT NULL,
  "orgId"       TEXT NOT NULL,
  "actorUserId" TEXT,
  "action"      TEXT NOT NULL,
  "payload"     TEXT,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrgAuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OrgAuditLog_orgId_idx" ON "OrgAuditLog"("orgId");
CREATE INDEX "OrgAuditLog_orgId_createdAt_idx" ON "OrgAuditLog"("orgId", "createdAt");
