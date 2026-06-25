/**
 * Unified spreadsheet → cell-grid parser.
 *
 * The roster/teacher importers accept CSV *and* Excel (.xlsx/.xls). Rather than
 * keep two parsers, every upload is read by SheetJS into a uniform grid of
 * strings: `header` (row 0) plus `rows` (the rest). Downstream code maps columns
 * by index and validates per-row, so this layer only has to produce strings.
 *
 * Why SheetJS and not the hand-rolled CSV parser: it transparently handles
 * .xlsx (a zip of XML the text parser can't read), BOMs, and odd delimiters,
 * which is exactly the real-world resilience schools' SIS exports need.
 *
 * Security: this carries student PII, so we keep the same guards as the legacy
 * CSV path — a 5 MB byte cap enforced BEFORE we read the bytes, and a 10k row
 * cap. We pin SheetJS to a CVE-patched release (0.20.x via the SheetJS CDN; the
 * npm `xlsx` is stuck on a vulnerable 0.18.5).
 */
import * as XLSX from "xlsx";
import type { ServerMessage } from "~/domain/types/server-message";
import {
  STUDENT_CSV_MAX_BYTES,
  STUDENT_CSV_MAX_ROWS,
} from "./student-roster.server";

export type SpreadsheetGrid = {
  /** First non-blank row, used as column headers. */
  header: string[];
  /** Remaining rows. Cells are raw strings; trimming happens at validation. */
  rows: string[][];
};

export type ParseGridResult =
  | { ok: true; grid: SpreadsheetGrid }
  | { ok: false; error: ServerMessage };

function cellToString(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

/**
 * Parse already-read bytes into a grid. Split out from {@link parseSpreadsheetToGrid}
 * so it is trivially unit-testable without constructing a File.
 */
export function parseGridFromBytes(
  data: ArrayBuffer | Uint8Array,
): ParseGridResult {
  let workbook: XLSX.WorkBook;
  try {
    // `raw: false` returns formatted text (numbers → "12", not 12); `dense`
    // is left default. SheetJS auto-detects CSV vs XLSX from the bytes.
    workbook = XLSX.read(data, { type: "array", raw: false });
  } catch {
    return { ok: false, error: { key: "errors:csvImport.fileReadFailed" } };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { ok: false, error: { key: "errors:csvImport.empty" } };
  }
  const sheet = workbook.Sheets[sheetName];

  // `header: 1` → array-of-arrays; `blankrows: false` drops fully empty rows;
  // `defval: ""` pads short rows to the sheet width so column indexes line up.
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  const grid = aoa.map((row) =>
    Array.isArray(row) ? row.map(cellToString) : [],
  );

  if (grid.length === 0) {
    return { ok: false, error: { key: "errors:csvImport.empty" } };
  }

  const header = grid[0];
  const rows = grid.slice(1);

  if (rows.length > STUDENT_CSV_MAX_ROWS) {
    return {
      ok: false,
      error: {
        key: "errors:csvImport.tooManyRows",
        params: { rows: rows.length, max: STUDENT_CSV_MAX_ROWS },
      },
    };
  }

  return { ok: true, grid: { header, rows } };
}

export async function parseSpreadsheetToGrid(
  file: File,
): Promise<ParseGridResult> {
  // Cap bytes BEFORE reading — a 128 MB Worker heap makes an unbounded read a
  // DoS vector.
  if (file.size > STUDENT_CSV_MAX_BYTES) {
    return {
      ok: false,
      error: {
        key: "errors:csvImport.fileTooLarge",
        params: { bytes: file.size, max: STUDENT_CSV_MAX_BYTES },
      },
    };
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return { ok: false, error: { key: "errors:csvImport.fileReadFailed" } };
  }

  return parseGridFromBytes(buffer);
}
