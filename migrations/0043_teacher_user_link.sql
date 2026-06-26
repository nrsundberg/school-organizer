-- Migration number: 0043 	 2026-06-26T00:06:13.000Z
-- Link a classroom (Teacher) to an optional teacher User account. Nullable so
-- existing rows need no backfill; teacherName remains the display fallback.
-- SetNull semantics are enforced at the app layer (D1/SQLite ALTER cannot add
-- an inline FK), matching how the other Teacher relations are modeled.
ALTER TABLE Teacher ADD COLUMN userId TEXT;
CREATE INDEX Teacher_userId_idx ON Teacher(userId);
