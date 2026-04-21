-- Password-reset support.
--
-- 1. `Org.passwordResetEnabled` — per-tenant toggle. Orgs using SSO can
--    disable self-serve password reset so users are forced through SSO.
--    Default true so nothing changes for existing orgs.
-- 2. `PasswordResetToken` — one row per reset request. We store only the
--    sha256 of the raw token; the raw token lives only in the outbound
--    email. Tokens have a short expiry (1 hour) and are consumed once.

ALTER TABLE "Org" ADD COLUMN "passwordResetEnabled" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "PasswordResetToken" (
  "id"               TEXT PRIMARY KEY NOT NULL,
  "userId"           TEXT NOT NULL,
  "tokenHash"        TEXT NOT NULL,
  "expiresAt"        DATETIME NOT NULL,
  "usedAt"           DATETIME,
  "requestedAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requestIp"        TEXT,
  "requestUserAgent" TEXT,
  CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "PasswordResetToken_tokenHash_idx"
  ON "PasswordResetToken"("tokenHash");

-- Fast lookup of a user's live (unused) tokens. The
-- `usedAt IS NULL` partial index keeps the index tiny: spent tokens
-- drop out automatically and are eventually pruned by the daily cron.
CREATE INDEX "PasswordResetToken_userId_active_idx"
  ON "PasswordResetToken"("userId") WHERE "usedAt" IS NULL;
