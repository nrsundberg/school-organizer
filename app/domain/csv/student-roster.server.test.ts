/**
 * Unit tests for the hardened student roster CSV importer.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCsv,
  parseStudentRoster,
  STUDENT_CSV_MAX_BYTES,
  STUDENT_CSV_MAX_ROWS,
} from "./student-roster.server";

/**
 * Minimal File shim — only the surface parseStudentRoster uses (size + text()).
 * Node 20+ has a global File, but its behavior across versions is inconsistent
 * enough that we'd rather pin it down.
 */
function makeFile(content: string): File {
  const bytes = new TextEncoder().encode(content);
  return {
    size: bytes.length,
    text: async () => content,
  } as unknown as File;
}

test("parseCsv: simple rows, no quotes", () => {
  const out = parseCsv("a,b,c\n1,2,3\n");
  assert.deepEqual(out, [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("parseCsv: quoted comma (O'Brien, Jr.)", () => {
  const csv = 'Last Name,First\n"O\'Brien, Jr.",Patrick\n';
  const out = parseCsv(csv);
  assert.deepEqual(out, [
    ["Last Name", "First"],
    ["O'Brien, Jr.", "Patrick"],
  ]);
});

test("parseCsv: escaped quotes inside a quoted field", () => {
  const csv = 'a,b\n"She said ""hi""",2\n';
  const out = parseCsv(csv);
  assert.deepEqual(out, [
    ["a", "b"],
    ['She said "hi"', "2"],
  ]);
});

test("parseCsv: CRLF line endings", () => {
  const out = parseCsv("a,b\r\n1,2\r\n");
  assert.deepEqual(out, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("parseStudentRoster: happy path", async () => {
  const csv =
    "Last Name,First,Carline Number,Homeroom\n" +
    "Smith,Alice,12,Room-1\n" +
    "Jones,Bob,7,Room-2\n";
  const result = await parseStudentRoster(makeFile(csv));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    "Last Name": "Smith",
    First: "Alice",
    "Carline Number": 12,
    Homeroom: "Room-1",
  });
  assert.equal(result.skippedBlank, 0);
});

test("parseStudentRoster: quoted comma in a name survives round-trip", async () => {
  const csv =
    "Last Name,First,Carline Number,Homeroom\n" +
    '"O\'Brien, Jr.",Patrick,3,Room-3\n';
  const result = await parseStudentRoster(makeFile(csv));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows[0]["Last Name"], "O'Brien, Jr.");
});

test("parseStudentRoster: honors alternate column order", async () => {
  const csv =
    "First,Carline Number,Homeroom,Last Name\n" + "Alice,12,Room-1,Smith\n";
  const result = await parseStudentRoster(makeFile(csv));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Carline Number must be 12 (a real int), not the last-name "Smith" parseInt'd.
  assert.equal(result.rows[0]["Carline Number"], 12);
  assert.equal(result.rows[0]["Last Name"], "Smith");
});

test("parseStudentRoster: empty required field is a row error (not silently dropped)", async () => {
  const csv =
    "Last Name,First,Carline Number,Homeroom\n" + "Smith,,12,Room-1\n";
  const result = await parseStudentRoster(makeFile(csv));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.rowErrors && result.rowErrors.length > 0);
  assert.equal(result.rowErrors[0].row, 2);
  assert.match(result.rowErrors[0].message, /First/);
});

test("parseStudentRoster: negative Carline Number rejected", async () => {
  const csv =
    "Last Name,First,Carline Number,Homeroom\n" + "Smith,Alice,-3,Room-1\n";
  const result = await parseStudentRoster(makeFile(csv));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.rowErrors && result.rowErrors.length > 0);
  assert.match(result.rowErrors[0].message, /Carline Number/);
});

test("parseStudentRoster: non-integer Carline Number rejected", async () => {
  const csv =
    "Last Name,First,Carline Number,Homeroom\n" +
    "Smith,Alice,not-a-number,Room-1\n";
  const result = await parseStudentRoster(makeFile(csv));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.rowErrors && result.rowErrors.length > 0);
});

test("parseStudentRoster: file over size cap rejected before parsing", async () => {
  const oversized = {
    size: STUDENT_CSV_MAX_BYTES + 1,
    // text() should NOT be called — fail if it is.
    text: async () => {
      throw new Error("text() must not be called on oversized files");
    },
  } as unknown as File;
  const result = await parseStudentRoster(oversized);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /too large/);
});

test("parseStudentRoster: file over row-count cap rejected", async () => {
  const header = "Last Name,First,Carline Number,Homeroom\n";
  const row = "Smith,Alice,12,Room-1\n";
  const csv = header + row.repeat(STUDENT_CSV_MAX_ROWS + 1);
  const result = await parseStudentRoster(makeFile(csv));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /maximum is/);
});

test("parseStudentRoster: unexpected header column rejected", async () => {
  const csv =
    "Last Name,First,Carline Number,Homeroom,SSN\n" +
    "Smith,Alice,12,Room-1,123-45-6789\n";
  const result = await parseStudentRoster(makeFile(csv));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /unexpected column/);
});

test("parseStudentRoster: missing required header rejected", async () => {
  const csv = "Last Name,First,Homeroom\n" + "Smith,Alice,Room-1\n";
  const result = await parseStudentRoster(makeFile(csv));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /missing required column/);
});

test("parseStudentRoster: blank line between rows is skipped with a count", async () => {
  const csv =
    "Last Name,First,Carline Number,Homeroom\n" +
    "Smith,Alice,12,Room-1\n" +
    "\n" +
    "Jones,Bob,7,Room-2\n";
  const result = await parseStudentRoster(makeFile(csv));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows.length, 2);
  assert.equal(result.skippedBlank, 1);
});

test("parseStudentRoster: row with wrong column count is a hard error", async () => {
  const csv =
    "Last Name,First,Carline Number,Homeroom\n" +
    "Smith,Alice,12\n"; // three cells, not four
  const result = await parseStudentRoster(makeFile(csv));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.rowErrors && result.rowErrors.length > 0);
  assert.match(result.rowErrors[0].message, /columns/);
});

test("parseStudentRoster: Object.create(null) rows have no prototype", async () => {
  // Smoke-test that a header named "__proto__" would be caught by the
  // allow-list, not silently land on Object.prototype.
  const csv =
    "Last Name,First,Carline Number,__proto__\n" + "Smith,Alice,12,Room-1\n";
  const result = await parseStudentRoster(makeFile(csv));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /(missing required|unexpected) column/);
});
