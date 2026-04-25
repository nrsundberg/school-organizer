-- Migration number: 0022 	 2026-04-25T13:20:08.988Z
--
-- i18n Phase 1: persist a per-user / per-org / per-teacher locale.
-- See docs/i18n-contract.md for the detector chain that consumes these.
--
-- User.locale       — preferred UI language for a logged-in user.
-- Org.defaultLocale — fallback for unauthenticated visitors on a tenant board
--                     and the locale used by org-wide print views.
-- Teacher.locale    — optional per-teacher override used by the homeroom
--                     print view; null means "fall back to Org.defaultLocale".

ALTER TABLE User ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE Org ADD COLUMN defaultLocale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE Teacher ADD COLUMN locale TEXT;
