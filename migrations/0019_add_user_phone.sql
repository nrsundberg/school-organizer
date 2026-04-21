-- Add `phone` to User.
--
-- Collected at signup going forward. Nullable because existing users
-- predate the field; we normalize submitted values to digits-only
-- (with optional leading `+` preserved) before persist.

ALTER TABLE "User" ADD COLUMN "phone" TEXT;
