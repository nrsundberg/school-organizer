-- Family grouping, dismissal exceptions, program cancellations, and ROI inputs.
-- All new tables are tenant-owned and must be queried through the tenant Prisma extension.

CREATE TABLE IF NOT EXISTS "Household" (
  "id"                  TEXT     NOT NULL PRIMARY KEY,
  "orgId"               TEXT     NOT NULL,
  "name"                TEXT     NOT NULL,
  "pickupNotes"         TEXT,
  "primaryContactName"  TEXT,
  "primaryContactPhone" TEXT,
  "createdAt"           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Household_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Household_orgId_idx" ON "Household"("orgId");
CREATE INDEX IF NOT EXISTS "Household_orgId_name_idx" ON "Household"("orgId", "name");
CREATE INDEX IF NOT EXISTS "Student_orgId_householdId_idx" ON "Student"("orgId", "householdId");

CREATE TABLE IF NOT EXISTS "DismissalException" (
  "id"                TEXT     NOT NULL PRIMARY KEY,
  "orgId"             TEXT     NOT NULL,
  "studentId"         INTEGER,
  "householdId"       TEXT,
  "scheduleKind"      TEXT     NOT NULL DEFAULT 'DATE',
  "exceptionDate"     DATETIME,
  "dayOfWeek"         INTEGER,
  "startsOn"          DATETIME,
  "endsOn"            DATETIME,
  "dismissalPlan"     TEXT     NOT NULL,
  "pickupContactName" TEXT,
  "notes"             TEXT,
  "isActive"          BOOLEAN  NOT NULL DEFAULT 1,
  "createdAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DismissalException_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DismissalException_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DismissalException_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DismissalException_orgId_idx" ON "DismissalException"("orgId");
CREATE INDEX IF NOT EXISTS "DismissalException_orgId_exceptionDate_idx" ON "DismissalException"("orgId", "exceptionDate");
CREATE INDEX IF NOT EXISTS "DismissalException_orgId_dayOfWeek_idx" ON "DismissalException"("orgId", "dayOfWeek");
CREATE INDEX IF NOT EXISTS "DismissalException_studentId_idx" ON "DismissalException"("studentId");
CREATE INDEX IF NOT EXISTS "DismissalException_householdId_idx" ON "DismissalException"("householdId");

CREATE TABLE IF NOT EXISTS "AfterSchoolProgram" (
  "id"          TEXT     NOT NULL PRIMARY KEY,
  "orgId"       TEXT     NOT NULL,
  "name"        TEXT     NOT NULL,
  "description" TEXT,
  "isActive"    BOOLEAN  NOT NULL DEFAULT 1,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AfterSchoolProgram_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AfterSchoolProgram_orgId_idx" ON "AfterSchoolProgram"("orgId");
CREATE INDEX IF NOT EXISTS "AfterSchoolProgram_orgId_name_idx" ON "AfterSchoolProgram"("orgId", "name");

CREATE TABLE IF NOT EXISTS "ProgramCancellation" (
  "id"               TEXT     NOT NULL PRIMARY KEY,
  "orgId"            TEXT     NOT NULL,
  "programId"        TEXT     NOT NULL,
  "cancellationDate" DATETIME NOT NULL,
  "title"            TEXT     NOT NULL,
  "message"          TEXT     NOT NULL,
  "deliveryMode"     TEXT     NOT NULL DEFAULT 'IN_APP',
  "createdByUserId"  TEXT,
  "createdAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgramCancellation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProgramCancellation_programId_fkey" FOREIGN KEY ("programId") REFERENCES "AfterSchoolProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProgramCancellation_orgId_idx" ON "ProgramCancellation"("orgId");
CREATE INDEX IF NOT EXISTS "ProgramCancellation_orgId_cancellationDate_idx" ON "ProgramCancellation"("orgId", "cancellationDate");
CREATE INDEX IF NOT EXISTS "ProgramCancellation_programId_idx" ON "ProgramCancellation"("programId");
