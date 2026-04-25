/**
 * Student roster CSV importer — hardened for P0-2.
 *
 * A school uploads a CSV of its student body here, so every byte of this file
 * is student PII. We enforce:
 *  - a 5 MB byte cap BEFORE reading file.text() (Workers' 128 MB heap DoS)
 *  - a 10,000 row cap
 *  - RFC-4180 parsing (handles "O'Brien, Jr." quoted-comma edge case)
 *  - exact header allow-list (no prototype-pollution-adjacent dynamic keys)
 *  - per-row Zod validation with field-level error messages
 *
 * The hand-rolled parser is ~40 lines — simpler to audit than pulling
 * papaparse into the Worker bundle. It is the subject of dedicated unit tests
 * and intentionally does NOT try to be a general CSV library (no streaming,
 * no type coercion outside Zod, no trimming inside quoted fields, etc.).
 */
import { z } from "zod";

export const STUDENT_CSV_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const STUDENT_CSV_MAX_ROWS = 10_000;

export const EXPECTED_HEADERS = [
  "Last Name",
  "First",
  "Carline Number",
  "Homeroom",
] as const;

/**
 * Per-row schema. `Carline Number` is coerced from string since CSV fields
 * always arrive as strings — we must validate positivity, not just truthiness.
 */
export const studentRowSchema = z.object({
  "Last Name": z.string().trim().min(1, "Last Name is required"),
  First: z.string().trim().min(1, "First is required"),
  "Carline Number": z.coerce
    .number({ error: "Carline Number must be a number" })
    .int("Carline Number must be an integer")
    .positive("Carline Number must be a positive integer"),
  Homeroom: z.string().trim().min(1, "Homeroom is required"),
});

export type StudentRow = z.infer<typeof studentRowSchema>;

export type ParseResult =
  | { ok: true; rows: StudentRow[]; skippedBlank: number }
  | {
      ok: false;
      error: string;
      rowErrors?: { row: number; message: string }[];
    };

/**
 * RFC-4180 compliant CSV parser. Supports:
 *  - quoted fields `"foo"`
 *  - commas inside quoted fields `"O'Brien, Jr."`
 *  - escaped quotes inside quoted fields `""`
 *  - CRLF and LF line endings
 *
 * Returns a 2D array of cells. Does not interpret headers or blank rows —
 * callers decide.
 */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote inside quoted field.
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === delimiter) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\r") {
      // Swallow the CR; if LF follows, the LF branch ends the row.
      i += 1;
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  // Flush the final field/row if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Returns true if a parsed CSV row is entirely empty (all cells whitespace).
 * Such rows are safe to skip silently (with a count note).
 */
function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => c.trim() === "");
}

/**
 * Build a plain object with `null` prototype — header keys cannot collide with
 * `__proto__`, `constructor`, etc. on Object.prototype.
 */
function makeRowObject(
  cells: string[],
  headerIndex: Record<(typeof EXPECTED_HEADERS)[number], number>
): Record<string, string> {
  const obj = Object.create(null) as Record<string, string>;
  for (const h of EXPECTED_HEADERS) {
    obj[h] = cells[headerIndex[h]] ?? "";
  }
  return obj;
}

/**
 * Primary entry point. Reads the uploaded File, parses it, validates it,
 * and returns a success or error discriminated union.
 */
export async function parseStudentRoster(file: File): Promise<ParseResult> {
  if (file.size > STUDENT_CSV_MAX_BYTES) {
    return {
      ok: false,
      error: `CSV file too large: ${file.size} bytes (max ${STUDENT_CSV_MAX_BYTES} bytes / 5 MB).`,
    };
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "Could not read uploaded file." };
  }

  const parsed = parseCsv(text);
  if (parsed.length === 0) {
    return { ok: false, error: "CSV is empty." };
  }

  const rawHeader = parsed[0].map((c) => c.trim());
  const body = parsed.slice(1);

  // Strict header allow-list: exact set, no extras, no missing.
  const expectedSet = new Set<string>(EXPECTED_HEADERS);
  const receivedSet = new Set(rawHeader);

  const missing = EXPECTED_HEADERS.filter((h) => !receivedSet.has(h));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `CSV is missing required column(s): ${missing.join(", ")}. Expected headers: ${EXPECTED_HEADERS.join(", ")}.`,
    };
  }
  const unknown = rawHeader.filter((h) => !expectedSet.has(h));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `CSV has unexpected column(s): ${unknown.join(", ")}. Expected exactly: ${EXPECTED_HEADERS.join(", ")}.`,
    };
  }

  // Build a lookup so we honor whatever column order the school's SIS exported.
  const headerIndex = Object.create(null) as Record<
    (typeof EXPECTED_HEADERS)[number],
    number
  >;
  for (const h of EXPECTED_HEADERS) {
    headerIndex[h] = rawHeader.indexOf(h);
  }

  // Non-blank rows drive both the row-cap and the validation loop.
  const nonBlankRows: { rowNumber: number; cells: string[] }[] = [];
  let skippedBlank = 0;
  for (let i = 0; i < body.length; i++) {
    const cells = body[i];
    // rowNumber is 1-indexed in the source file, including header → +2.
    const rowNumber = i + 2;
    if (isBlankRow(cells)) {
      skippedBlank += 1;
      continue;
    }
    nonBlankRows.push({ rowNumber, cells });
  }

  if (nonBlankRows.length > STUDENT_CSV_MAX_ROWS) {
    return {
      ok: false,
      error: `CSV has ${nonBlankRows.length} rows; maximum is ${STUDENT_CSV_MAX_ROWS}.`,
    };
  }

  const rows: StudentRow[] = [];
  const rowErrors: { row: number; message: string }[] = [];

  for (const { rowNumber, cells } of nonBlankRows) {
    // A short/long row is a hard error — we do NOT silently pad or trim.
    if (cells.length !== rawHeader.length) {
      rowErrors.push({
        row: rowNumber,
        message: `Row has ${cells.length} columns; expected ${rawHeader.length}.`,
      });
      continue;
    }

    const obj = makeRowObject(cells, headerIndex);
    const result = studentRowSchema.safeParse(obj);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field =
          issue.path.length > 0 ? String(issue.path[0]) : "(unknown)";
        rowErrors.push({
          row: rowNumber,
          message: `${field}: ${issue.message}`,
        });
      }
      continue;
    }
    rows.push(result.data);
  }

  if (rowErrors.length > 0) {
    return {
      ok: false,
      error: `CSV has ${rowErrors.length} validation error(s). Fix and re-upload.`,
      rowErrors,
    };
  }

  return { ok: true, rows, skippedBlank };
}
