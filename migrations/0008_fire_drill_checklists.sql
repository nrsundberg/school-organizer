-- Fire drill / configurable checklist templates and run state
CREATE TABLE "FireDrillTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FireDrillTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FireDrillTemplate_orgId_idx" ON "FireDrillTemplate"("orgId");

CREATE TABLE "FireDrillRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FireDrillRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FireDrillRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FireDrillTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FireDrillRun_templateId_key" ON "FireDrillRun"("templateId");
CREATE INDEX "FireDrillRun_orgId_idx" ON "FireDrillRun"("orgId");
