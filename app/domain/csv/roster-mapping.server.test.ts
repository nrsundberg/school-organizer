/**
 * Tests for the mapping-driven roster import core. The importer no longer
 * hard-fails on unrecognized headers — it *suggests* a column mapping (which the
 * admin can override in the UI), then applies that mapping to the parsed grid.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyColumnMapping,
  suggestColumnMapping,
  type ColumnMapping,
} from "./roster-import.server";
import type { SpreadsheetGrid } from "./spreadsheet.server";

test("suggestColumnMapping: detects fields via header aliases (any order)", () => {
  const mapping = suggestColumnMapping([
    "Surname",
    "First Name",
    "Class",
    "Carline Number",
  ]);
  assert.equal(mapping.lastName, 0);
  assert.equal(mapping.firstName, 1);
  assert.equal(mapping.homeRoom, 2);
  assert.equal(mapping.spaceNumber, 3);
});

test("suggestColumnMapping: leaves unknown headers unmapped (null)", () => {
  const mapping = suggestColumnMapping(["Pupil", "Room", "Notes"]);
  assert.equal(mapping.firstName, null);
  assert.equal(mapping.lastName, null);
  // "Room" is not an alias for homeRoom ("classroom"/"class"/"home room" are).
  assert.equal(mapping.homeRoom, null);
});

test("applyColumnMapping: maps a grid into rows, trimming + parsing space", () => {
  const grid: SpreadsheetGrid = {
    header: ["First Name", "Surname", "Class", "Carline Number"],
    rows: [
      [" Ada ", "Lovelace", "Room 101", "12"],
      ["Grace", "Hopper", "Room 102", ""],
    ],
  };
  const mapping = suggestColumnMapping(grid.header);
  const result = applyColumnMapping(grid, mapping);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    rowNumber: 2,
    firstName: "Ada",
    lastName: "Lovelace",
    homeRoom: "Room 101",
    spaceNumber: 12,
  });
  assert.equal(result.rows[1].spaceNumber, null);
  assert.equal(result.rowErrors.length, 0);
});

test("applyColumnMapping: honors an explicit mapping that overrides detection", () => {
  // Header SheetJS could never alias — admin maps "Pupil"/"Fam" by hand.
  const grid: SpreadsheetGrid = {
    header: ["Pupil", "Fam", "HR"],
    rows: [["Ada", "Lovelace", "Room 101"]],
  };
  const mapping: ColumnMapping = {
    firstName: 0,
    lastName: 1,
    homeRoom: 2,
    spaceNumber: null,
  };
  const result = applyColumnMapping(grid, mapping);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows[0].firstName, "Ada");
  assert.equal(result.rows[0].homeRoom, "Room 101");
});

test("applyColumnMapping: missing a required field returns missingColumns", () => {
  const grid: SpreadsheetGrid = { header: ["First", "Class"], rows: [] };
  const mapping: ColumnMapping = {
    firstName: 0,
    lastName: null,
    homeRoom: 1,
    spaceNumber: null,
  };
  const result = applyColumnMapping(grid, mapping);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.key, "errors:csvImport.missingColumns");
  assert.match(String(result.error.params?.columns), /lastName/);
});

test("applyColumnMapping: collects per-row errors and in-file duplicates", () => {
  const grid: SpreadsheetGrid = {
    header: ["First", "Last", "Class"],
    rows: [
      ["Ada", "Lovelace", "Room 101"],
      ["", "Hopper", "Room 102"], // missing first name
      ["Ada", "Lovelace", "Room 101"], // duplicate of row 2
    ],
  };
  const mapping = suggestColumnMapping(grid.header);
  const result = applyColumnMapping(grid, mapping);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows.length, 1, "only the first valid, unique row survives");
  const keys = result.rowErrors.map((e) => e.message.key);
  assert.ok(keys.includes("errors:csvImport.firstNameRequired"));
  assert.ok(keys.includes("errors:csvImport.duplicateRow"));
});

test("applyColumnMapping: blank rows are skipped, not errored", () => {
  const grid: SpreadsheetGrid = {
    header: ["First", "Last", "Class"],
    rows: [["", "", ""], ["Ada", "Lovelace", "Room 101"]],
  };
  const mapping = suggestColumnMapping(grid.header);
  const result = applyColumnMapping(grid, mapping);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.skippedBlank, 1);
  assert.equal(result.rows.length, 1);
});
