-- Migration number: 0040 	 2026-06-19T10:54:42.336Z
-- Optional name suffix (Jr., Sr., II, III, IV, etc.) for students. Nullable so existing rows need no backfill.
ALTER TABLE Student ADD COLUMN suffix TEXT;
