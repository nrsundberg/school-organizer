-- User-invite tokens for the "staff creates a user" flow.
--
-- Invitees click the link in the email, set a password, and are signed in
-- — temp passwords never leave the server. Same sha256-hashed token
-- discipline as PasswordResetToken (0018); longer TTL (7 days default) and
-- a separate table so revoke/resend semantics and the audit trail stay
-- clean.

CREATE TABLE "UserInviteToken" (
  "id"              TEXT PRIMARY KEY NOT NULL,
  "userId"          TEXT NOT NULL,
  "tokenHash"       TEXT NOT NULL,
  "expiresAt"       DATETIME NOT NULL,
  "usedAt"          DATETIME,
  "revokedAt"       DATETIME,
  "invitedByUserId" TEXT,
  "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserInviteToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "UserInviteToken_tokenHash_idx"
  ON "UserInviteToken"("tokenHash");

-- Fast lookup of a user's pending invites. Partial index keeps the index
-- tiny: consumed/revoked tokens drop out automatically.
CREATE INDEX "UserInviteToken_userId_pending_idx"
  ON "UserInviteToken"("userId") WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;
