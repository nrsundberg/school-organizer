import { z } from "zod";
import {
  parseCsv,
  STUDENT_CSV_MAX_BYTES,
  STUDENT_CSV_MAX_ROWS,
  type StudentRow,
} from "./student-roster.server";

export const ROSTER_IMPORT_TEMPLATE_CSV =
  "firstName,lastName,homeRoom,spaceNumber\n" +
  "Ada,Lovelace,Room 101,12\n" +
  "Grace,Hopper,Room 102,13\n";

export type RosterImportRow = {
  rowNumber: number;
  firstName: string;
  lastName: string;
  homeRoom: string | null;
  spaceNumber: number | null;
};

export type RosterRowError = {
  row: number;
  message: string;
};

export type RosterImportParseResult =
  | {
      ok: true;
      rows: RosterImportRow[];
      rowErrors: RosterRowError[];
      skippedBlank: number;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
      rowErrors?: RosterRowError[];
    };

export type ExistingRosterSnapshot = {
  students: {
    id: number;
    firstName: string;
    lastName: string;
    homeRoom: string | null;
    spaceNumber: number | null;
  }[];
  teachers: { homeRoom: string }[];
  spaces: { spaceNumber: number }[];
};

export type RosterPreviewRow = RosterImportRow & {
  status: "new" | "update" | "error";
  studentId: number | null;
  message: string;
};

export type RosterImportPlan = {
  rows: RosterPreviewRow[];
  summary: {
    validRows: number;
    createCount: number;
    updateCount: number;
    errorCount: number;
    newHomerooms: number;
    newSpaces: number;
  };
  newHomerooms: string[];
  newSpaces: number[];
};

export type RosterApplySummary = {
  created: number;
  updated: number;
  newHomerooms: number;
  newSpaces: number;
};

type RosterPrisma = {
  student: {
    findMany: (args: {
      select: {
        id: true;
        firstName: true;
        lastName: true;
        homeRoom: true;
        spaceNumber: true;
      };
      orderBy?: { lastName: "asc" }[];
    }) => Promise<ExistingRosterSnapshot["students"]>;
    createMany: (args: {
      data: {
        firstName: string;
        lastName: string;
        homeRoom: string | null;
        spaceNumber: number | null;
        householdId: string | null;
      }[];
    }) => Promise<unknown>;
    updateMany: (args: {
      where: { id: number };
      data: { spaceNumber: number | null };
    }) => Promise<unknown>;
  };
  teacher: {
    findMany: (args: {
      select: { homeRoom: true };
      orderBy?: { homeRoom: "asc" };
    }) => Promise<ExistingRosterSnapshot["teachers"]>;
    create: (args: { data: { homeRoom: string } }) => Promise<unknown>;
  };
  space: {
    findMany: (args: {
      select: { spaceNumber: true };
      orderBy?: { spaceNumber: "asc" };
    }) => Promise<ExistingRosterSnapshot["spaces"]>;
    create: (args: { data: { spaceNumber: number } }) => Promise<unknown>;
  };
};

const serializedRosterRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  homeRoom: z.string().trim().min(1).nullable(),
  spaceNumber: z.number().int().positive().nullable(),
});

const serializedRosterRowsSchema = z.array(serializedRosterRowSchema);

const HEADER_ALIASES = {
  firstName: ["firstname", "first name", "first"],
  lastName: ["lastname", "last name", "last", "surname"],
  homeRoom: ["homeroom", "home room", "classroom", "class"],
  spaceNumber: [
    "spacenumber",
    "space number",
    "parking space number",
    "parking space",
    "carline number",
    "car line number",
    "carline",
  ],
  ignored: ["grade", "guardianemail", "guardian email", "parentemail", "parent email"],
} as const;

type CanonicalHeader = keyof typeof HEADER_ALIASES;
type RequiredHeader = "firstName" | "lastName" | "homeRoom";
type OptionalHeader = "spaceNumber";

function normalizeHeader(value: string): string {
  return value
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeKeyPart(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function rosterKey(row: Pick<RosterImportRow, "firstName" | "lastName" | "homeRoom">): string {
  return [
    normalizeKeyPart(row.firstName),
    normalizeKeyPart(row.lastName),
    normalizeKeyPart(row.homeRoom),
  ].join("\u0000");
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((cell) => cell.trim() === "");
}

function firstNonEmptyLine(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0) ?? "";
}

function sniffDelimiter(text: string): "," | ";" {
  const headerLine = firstNonEmptyLine(text);
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  const semicolonCount = (headerLine.match(/;/g) ?? []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function canonicalForHeader(rawHeader: string): CanonicalHeader | null {
  const normalized = normalizeHeader(rawHeader);
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if ((aliases as readonly string[]).includes(normalized)) {
      return canonical as CanonicalHeader;
    }
  }
  return null;
}

function resolveHeaderIndexes(rawHeader: string[]):
  | {
      ok: true;
      indexes: Record<RequiredHeader, number> & Partial<Record<OptionalHeader, number>>;
      ignoredColumns: string[];
    }
  | { ok: false; error: string } {
  const indexes: Partial<Record<RequiredHeader | OptionalHeader, number>> = {};
  const ignoredColumns: string[] = [];
  const seen = new Set<CanonicalHeader>();
  const unknown: string[] = [];

  rawHeader.forEach((header, index) => {
    const canonical = canonicalForHeader(header);
    if (!canonical) {
      unknown.push(header.trim() || `(blank column ${index + 1})`);
      return;
    }

    if (canonical === "ignored") {
      ignoredColumns.push(header.trim());
      return;
    }

    if (seen.has(canonical)) {
      unknown.push(`${header.trim()} (duplicate ${canonical} column)`);
      return;
    }

    seen.add(canonical);
    indexes[canonical] = index;
  });

  if (unknown.length > 0) {
    return {
      ok: false,
      error: `CSV has unsupported column(s): ${unknown.join(", ")}. Use firstName, lastName, homeRoom, and optional spaceNumber.`,
    };
  }

  const missing = (["firstName", "lastName", "homeRoom"] as const).filter(
    (header) => indexes[header] == null,
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: `CSV is missing required column(s): ${missing.join(", ")}. Download the template for the expected format.`,
    };
  }

  return {
    ok: true,
    indexes: indexes as Record<RequiredHeader, number> &
      Partial<Record<OptionalHeader, number>>,
    ignoredColumns,
  };
}

function cell(cells: string[], index: number | undefined): string {
  if (index == null) return "";
  return cells[index] ?? "";
}

function parseSpaceNumber(value: string, rowNumber: number): number | null | RosterRowError {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return {
      row: rowNumber,
      message: "spaceNumber must be a positive whole number.",
    };
  }
  return numeric;
}

export function parseRosterImportText(text: string): RosterImportParseResult {
  const delimiter = sniffDelimiter(text);
  const parsed = parseCsv(text.replace(/^\uFEFF/, ""), delimiter);
  if (parsed.length === 0) {
    return { ok: false, error: "CSV is empty." };
  }

  const rawHeader = parsed[0].map((header) => header.trim());
  const resolved = resolveHeaderIndexes(rawHeader);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  const rowErrors: RosterRowError[] = [];
  const rows: RosterImportRow[] = [];
  const seenRows = new Set<string>();
  let skippedBlank = 0;

  const body = parsed.slice(1);
  for (let i = 0; i < body.length; i += 1) {
    const cells = body[i];
    const rowNumber = i + 2;
    if (isBlankRow(cells)) {
      skippedBlank += 1;
      continue;
    }

    if (cells.length !== rawHeader.length) {
      rowErrors.push({
        row: rowNumber,
        message: `Row has ${cells.length} columns; expected ${rawHeader.length}.`,
      });
      continue;
    }

    const firstName = cell(cells, resolved.indexes.firstName).trim();
    const lastName = cell(cells, resolved.indexes.lastName).trim();
    const homeRoomValue = cell(cells, resolved.indexes.homeRoom).trim();
    const homeRoom = homeRoomValue || null;
    const spaceNumber = parseSpaceNumber(
      cell(cells, resolved.indexes.spaceNumber),
      rowNumber,
    );

    if (!firstName) {
      rowErrors.push({ row: rowNumber, message: "firstName is required." });
    }
    if (!lastName) {
      rowErrors.push({ row: rowNumber, message: "lastName is required." });
    }
    if (spaceNumber && typeof spaceNumber === "object") {
      rowErrors.push(spaceNumber);
    }
    if (!firstName || !lastName || (spaceNumber && typeof spaceNumber === "object")) {
      continue;
    }

    const row: RosterImportRow = {
      rowNumber,
      firstName,
      lastName,
      homeRoom,
      spaceNumber,
    };
    const key = rosterKey(row);
    if (seenRows.has(key)) {
      rowErrors.push({
        row: rowNumber,
        message:
          "Duplicate student in this file. Dedupe uses firstName + lastName + homeRoom.",
      });
      continue;
    }
    seenRows.add(key);
    rows.push(row);
  }

  if (rows.length > STUDENT_CSV_MAX_ROWS) {
    return {
      ok: false,
      error: `CSV has ${rows.length} rows; maximum is ${STUDENT_CSV_MAX_ROWS}.`,
    };
  }

  const warnings =
    resolved.ignoredColumns.length > 0
      ? [
          `Ignored unsupported roster detail column(s): ${resolved.ignoredColumns.join(", ")}. These are not stored on student records yet.`,
        ]
      : [];

  return { ok: true, rows, rowErrors, skippedBlank, warnings };
}

export async function parseRosterImportFile(file: File): Promise<RosterImportParseResult> {
  if (file.size > STUDENT_CSV_MAX_BYTES) {
    return {
      ok: false,
      error: `CSV file too large: ${file.size} bytes (max ${STUDENT_CSV_MAX_BYTES} bytes / 5 MB).`,
    };
  }

  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    return {
      ok: false,
      error:
        "XLSX import is not enabled yet. Please download the CSV template and upload a .csv file.",
    };
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "Could not read uploaded file." };
  }

  return parseRosterImportText(text);
}

export function legacyStudentRowsToRosterImportRows(
  rows: StudentRow[],
): RosterImportRow[] {
  return rows.map((row, index) => ({
    rowNumber: index + 2,
    firstName: row.First,
    lastName: row["Last Name"],
    homeRoom: row.Homeroom,
    spaceNumber: row["Carline Number"],
  }));
}

export function serializeRosterRows(rows: RosterImportRow[]): string {
  return JSON.stringify(rows);
}

export function parseSerializedRosterRows(value: FormDataEntryValue | null): RosterImportRow[] {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Missing roster rows to import. Preview the CSV again.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Could not read roster preview data. Preview the CSV again.");
  }

  return serializedRosterRowsSchema.parse(parsed);
}

export function buildRosterImportPlan(
  rows: RosterImportRow[],
  snapshot: ExistingRosterSnapshot,
): RosterImportPlan {
  const existingStudentByKey = new Map<string, ExistingRosterSnapshot["students"][number]>();
  for (const student of snapshot.students) {
    const key = rosterKey(student);
    if (!existingStudentByKey.has(key)) {
      existingStudentByKey.set(key, student);
    }
  }

  const existingHomerooms = new Set(
    snapshot.teachers.map((teacher) => normalizeKeyPart(teacher.homeRoom)),
  );
  const existingSpaces = new Set(snapshot.spaces.map((space) => space.spaceNumber));
  const plannedHomerooms = new Set<string>();
  const plannedSpaces = new Set<number>();
  const newHomeroomsByKey = new Map<string, string>();

  const previewRows: RosterPreviewRow[] = rows.map((row) => {
    const existing = existingStudentByKey.get(rosterKey(row));
    const status = existing ? "update" : "new";

    if (row.homeRoom) {
      const homeroomKey = normalizeKeyPart(row.homeRoom);
      if (!existingHomerooms.has(homeroomKey) && !plannedHomerooms.has(homeroomKey)) {
        plannedHomerooms.add(homeroomKey);
        newHomeroomsByKey.set(homeroomKey, row.homeRoom);
      }
    }

    if (row.spaceNumber && !existingSpaces.has(row.spaceNumber)) {
      plannedSpaces.add(row.spaceNumber);
    }

    return {
      ...row,
      status,
      studentId: existing?.id ?? null,
      message: existing
        ? "Will update the parking space for the matching student."
        : "Will create a new student record.",
    };
  });

  const createCount = previewRows.filter((row) => row.status === "new").length;
  const updateCount = previewRows.filter((row) => row.status === "update").length;
  const errorCount = previewRows.filter((row) => row.status === "error").length;

  return {
    rows: previewRows,
    summary: {
      validRows: rows.length,
      createCount,
      updateCount,
      errorCount,
      newHomerooms: newHomeroomsByKey.size,
      newSpaces: plannedSpaces.size,
    },
    newHomerooms: Array.from(newHomeroomsByKey.values()).sort((a, b) =>
      a.localeCompare(b),
    ),
    newSpaces: Array.from(plannedSpaces).sort((a, b) => a - b),
  };
}

export async function buildRosterImportPlanFromDatabase(
  prisma: RosterPrisma,
  rows: RosterImportRow[],
): Promise<RosterImportPlan> {
  const [students, teachers, spaces] = await Promise.all([
    prisma.student.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        homeRoom: true,
        spaceNumber: true,
      },
      orderBy: [{ lastName: "asc" }],
    }),
    prisma.teacher.findMany({
      select: { homeRoom: true },
      orderBy: { homeRoom: "asc" },
    }),
    prisma.space.findMany({
      select: { spaceNumber: true },
      orderBy: { spaceNumber: "asc" },
    }),
  ]);

  return buildRosterImportPlan(rows, { students, teachers, spaces });
}

export async function applyRosterImport(
  prisma: RosterPrisma,
  rows: RosterImportRow[],
): Promise<RosterApplySummary> {
  const plan = await buildRosterImportPlanFromDatabase(prisma, rows);
  if (plan.summary.errorCount > 0) {
    throw new Error("Fix row errors before importing the roster.");
  }

  for (const homeRoom of plan.newHomerooms) {
    await prisma.teacher.create({ data: { homeRoom } });
  }

  for (const spaceNumber of plan.newSpaces) {
    await prisma.space.create({ data: { spaceNumber } });
  }

  const rowsToCreate = plan.rows
    .filter((row) => row.status === "new")
    .map((row) => ({
      firstName: row.firstName,
      lastName: row.lastName,
      homeRoom: row.homeRoom,
      spaceNumber: row.spaceNumber,
      householdId: null,
    }));

  const CHUNK_SIZE = 50;
  for (let i = 0; i < rowsToCreate.length; i += CHUNK_SIZE) {
    await prisma.student.createMany({
      data: rowsToCreate.slice(i, i + CHUNK_SIZE),
    });
  }

  for (const row of plan.rows.filter((previewRow) => previewRow.status === "update")) {
    if (!row.studentId) continue;
    await prisma.student.updateMany({
      where: { id: row.studentId },
      data: { spaceNumber: row.spaceNumber },
    });
  }

  return {
    created: plan.summary.createCount,
    updated: plan.summary.updateCount,
    newHomerooms: plan.summary.newHomerooms,
    newSpaces: plan.summary.newSpaces,
  };
}
