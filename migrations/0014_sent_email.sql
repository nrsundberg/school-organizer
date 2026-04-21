-- Idempotency log for lifecycle/trial emails.
CREATE TABLE "SentEmail" (
  "id"     TEXT PRIMARY KEY NOT NULL,
  "orgId"  TEXT NOT NULL,
  "kind"   TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SentEmail_orgId_kind_bucket_key" ON "SentEmail"("orgId", "kind", "bucket");
CREATE INDEX "SentEmail_orgId_idx" ON "SentEmail"("orgId");
