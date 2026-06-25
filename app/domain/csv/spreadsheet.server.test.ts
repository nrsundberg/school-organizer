/**
 * Tests for the unified spreadsheet → cell-grid parser. Both CSV and XLSX flow
 * through SheetJS so the importer has a single code path; this verifies the
 * round-trip produces the same string grid for both formats and that the size /
 * empty / row-cap guards still fire (they carry student PII, so the caps matter).
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseSpreadsheetToGrid } from "./spreadsheet.server";
import { STUDENT_CSV_MAX_BYTES } from "./student-roster.server";

function xlsxFile(aoa: (string | number)[][], name = "roster.xlsx"): File {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  return new File([out], name);
}

test("parseSpreadsheetToGrid: parses a CSV file into header + rows", async () => {
  const file = new File(
    ["firstName,lastName,homeRoom\nAda,Lovelace,Room 101\nGrace,Hopper,Room 102\n"],
    "roster.csv",
    { type: "text/csv" },
  );

  const result = await parseSpreadsheetToGrid(file);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.grid.header, ["firstName", "lastName", "homeRoom"]);
  assert.equal(result.grid.rows.length, 2);
  assert.deepEqual(result.grid.rows[0], ["Ada", "Lovelace", "Room 101"]);
});

test("parseSpreadsheetToGrid: parses an XLSX file into the same grid", async () => {
  const file = xlsxFile([
    ["firstName", "lastName", "homeRoom", "spaceNumber"],
    ["Ada", "Lovelace", "Room 101", 12],
  ]);

  const result = await parseSpreadsheetToGrid(file);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.grid.header, ["firstName", "lastName", "homeRoom", "spaceNumber"]);
  // Numbers come back as strings so downstream validation is uniform.
  assert.deepEqual(result.grid.rows[0], ["Ada", "Lovelace", "Room 101", "12"]);
});

test("parseSpreadsheetToGrid: empty file is rejected", async () => {
  const file = new File([""], "empty.csv", { type: "text/csv" });
  const result = await parseSpreadsheetToGrid(file);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.key, "errors:csvImport.empty");
});

test("parseSpreadsheetToGrid: oversized file is rejected before reading", async () => {
  // Fake a File whose size exceeds the cap; arrayBuffer() must never be called.
  const fake = {
    size: STUDENT_CSV_MAX_BYTES + 1,
    name: "huge.xlsx",
    arrayBuffer: async () => {
      throw new Error("should not read an oversized file");
    },
  } as unknown as File;

  const result = await parseSpreadsheetToGrid(fake);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.key, "errors:csvImport.fileTooLarge");
});

test("parseSpreadsheetToGrid: ragged rows keep their cells (no strict column count)", async () => {
  const file = new File(
    ["firstName,lastName,homeRoom\nAda,Lovelace\n"],
    "roster.csv",
    { type: "text/csv" },
  );
  const result = await parseSpreadsheetToGrid(file);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.grid.rows[0][0], "Ada");
  assert.equal(result.grid.rows[0][1], "Lovelace");
});
