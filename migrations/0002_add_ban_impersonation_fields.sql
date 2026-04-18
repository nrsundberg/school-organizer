-- Add admin plugin fields: ban support on User, impersonation tracking on Session
ALTER TABLE "User" ADD COLUMN "banned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "banReason" TEXT;
ALTER TABLE "User" ADD COLUMN "banExpires" INTEGER;
ALTER TABLE "Session" ADD COLUMN "impersonatedBy" TEXT;
