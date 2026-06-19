-- Migration number: 0041 	 2026-06-19T00:00:00.000Z
-- Per-tenant pickup-history retention window (days). D1 has no native row TTL,
-- so a daily cron prunes CallEvent older than this window. NOT NULL with a
-- constant default of 90, so every existing AppSettings row is backfilled to
-- the standard 90-day window with no data migration.
ALTER TABLE AppSettings ADD COLUMN historyRetentionDays INTEGER NOT NULL DEFAULT 90;
