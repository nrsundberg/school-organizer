-- Per-org usage cap overrides. Null = use plan tier default.
ALTER TABLE Org ADD COLUMN limitStudents    INTEGER;
ALTER TABLE Org ADD COLUMN limitFamilies    INTEGER;
ALTER TABLE Org ADD COLUMN limitClassrooms  INTEGER;
