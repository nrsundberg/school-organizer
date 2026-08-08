/**
 * Teacher import: bulk-create classroom (homeroom) records from a spreadsheet
 * and invite each teacher as an org user.
 *
 * Reuses the same parse → map → preview → apply shape as the roster importer.
 * Teachers become org users via the existing inviteUser() flow (CONTROLLER or
 * VIEWER role) — this module stays prisma/auth-agnostic by taking the actual
 * invite as an injected function, so the planning + apply logic unit-tests
 * against simple fakes. See teacher-import.server.test.ts.
 */
import { z } from "zod";
import type { ServerMessage } from "~/domain/types/server-message";
import type { SpreadsheetGrid } from "~/domain/csv/spreadsheet.server";

/** Roles a teacher import may assign (org scope). */
export type TeacherRole = "VIEWER" | "CONTROLLER";

export type TeacherImportRow = {
  rowNumber: number;
  name: string;
  email: string;
  homeRoom: string;
  role: TeacherRole;
};

export type TeacherRowError = {
  row: number;
  message: ServerMessage;
};

export type TeacherField = "name" | "email" | "homeRoom" | "role";

export const TEACHER_FIELDS: readonly TeacherField[] = [
  "name",
  "email",
  "homeRoom",
  "role",
];

export const TEACHER_REQUIRED_FIELDS: readonly TeacherField[] = [
  "name",
  "email",
  "homeRoom",
];

export type TeacherColumnMapping = Record<TeacherField, number | null>;

const HEADER_ALIASES: Record<TeacherField, string[]> = {
  name: ["teacher", "teacher name", "name", "full name", "staff", "staff name"],
  email: ["email", "email address", "e mail", "work email"],
  homeRoom: ["homeroom", "home room", "classroom", "class", "room"],
  role: ["role", "access", "permission", "access level"],
};

function normalizeHeader(value: string): string {
  return value
    .trim()
    .replace(/^﻿/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function canonicalForHeader(raw: string): TeacherField | null {
  const normalized = normalizeHeader(raw);
  for (const field of TEACHER_FIELDS) {
    if (HEADER_ALIASES[field].includes(normalized)) return field;
  }
  return null;
}

export function suggestTeacherMapping(header: string[]): TeacherColumnMapping {
  const mapping: TeacherColumnMapping = {
    name: null,
    email: null,
    homeRoom: null,
    role: null,
  };
  header.forEach((raw, index) => {
    const field = canonicalForHeader(raw);
    if (field && mapping[field] == null) mapping[field] = index;
  });
  return mapping;
}

const teacherMappingSchema = z.object({
  name: z.number().int().nonnegative().nullable(),
  email: z.number().int().nonnegative().nullable(),
  homeRoom: z.number().int().nonnegative().nullable(),
  role: z.number().int().nonnegative().nullable(),
});

export function parseTeacherMapping(value: unknown): TeacherColumnMapping {
  return teacherMappingSchema.parse(value);
}

const EMAIL_RE = /.+@.+\..+/;

function cell(cells: string[], index: number | null): string {
  if (index == null) return "";
  return cells[index] ?? "";
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => c.trim() === "");
}

/** Resolve a per-row role cell, falling back to the batch default. */
function resolveRole(value: string, fallback: TeacherRole): TeacherRole {
  const normalized = value.trim().toLowerCase();
  if (normalized === "controller") return "CONTROLLER";
  if (normalized === "viewer") return "VIEWER";
  return fallback;
}

export type TeacherMappingApplyResult =
  | {
      ok: true;
      rows: TeacherImportRow[];
      rowErrors: TeacherRowError[];
      skippedBlank: number;
    }
  | { ok: false; error: ServerMessage };

export function applyTeacherMapping(
  grid: SpreadsheetGrid,
  mapping: TeacherColumnMapping,
  defaultRole: TeacherRole,
): TeacherMappingApplyResult {
  const missing = TEACHER_REQUIRED_FIELDS.filter((field) => mapping[field] == null);
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        key: "errors:teacherImport.missingColumns",
        params: { columns: missing.join(", ") },
      },
    };
  }

  const rows: TeacherImportRow[] = [];
  const rowErrors: TeacherRowError[] = [];
  const seenEmails = new Set<string>();
  let skippedBlank = 0;

  grid.rows.forEach((cells, i) => {
    const rowNumber = i + 2;
    if (isBlankRow(cells)) {
      skippedBlank += 1;
      return;
    }

    const name = cell(cells, mapping.name).trim();
    const email = cell(cells, mapping.email).trim().toLowerCase();
    const homeRoom = cell(cells, mapping.homeRoom).trim();
    const role = resolveRole(cell(cells, mapping.role), defaultRole);

    if (!name) {
      rowErrors.push({ row: rowNumber, message: { key: "errors:teacherImport.nameRequired" } });
    }
    if (!email || !EMAIL_RE.test(email)) {
      rowErrors.push({ row: rowNumber, message: { key: "errors:teacherImport.emailInvalid" } });
    }
    if (!homeRoom) {
      rowErrors.push({ row: rowNumber, message: { key: "errors:teacherImport.homeRoomRequired" } });
    }
    if (!name || !email || !EMAIL_RE.test(email) || !homeRoom) return;

    if (seenEmails.has(email)) {
      rowErrors.push({ row: rowNumber, message: { key: "errors:teacherImport.duplicateEmail" } });
      return;
    }
    seenEmails.add(email);
    rows.push({ rowNumber, name, email, homeRoom, role });
  });

  return { ok: true, rows, rowErrors, skippedBlank };
}

export type TeacherPreviewRow = TeacherImportRow & {
  /** "invite" = no account yet; "existing" = email already a user (skipped). */
  status: "invite" | "existing";
  homeroomNew: boolean;
};

export type TeacherImportPlan = {
  rows: TeacherPreviewRow[];
  summary: {
    total: number;
    inviteCount: number;
    existingCount: number;
    newHomerooms: number;
  };
  newHomerooms: string[];
};

export type TeacherPlanPrisma = {
  user: {
    findMany: (args: {
      where: { email: { in: string[] } };
      select: { email: true };
    }) => Promise<{ email: string }[]>;
  };
  teacher: {
    findMany: (args: { select: { homeRoom: true } }) => Promise<{ homeRoom: string }[]>;
  };
};

function normalizeRoom(value: string): string {
  return value.trim().toLowerCase();
}

export async function buildTeacherImportPlan(
  prisma: TeacherPlanPrisma,
  rows: TeacherImportRow[],
): Promise<TeacherImportPlan> {
  const emails = rows.map((r) => r.email);
  const [existingUsers, teachers] = await Promise.all([
    emails.length > 0
      ? prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } })
      : Promise.resolve([]),
    prisma.teacher.findMany({ select: { homeRoom: true } }),
  ]);

  const existingEmails = new Set(existingUsers.map((u) => u.email.toLowerCase()));
  const existingHomerooms = new Set(teachers.map((t) => normalizeRoom(t.homeRoom)));
  const plannedHomerooms = new Set<string>();
  const newHomerooms: string[] = [];

  const previewRows: TeacherPreviewRow[] = rows.map((row) => {
    const roomKey = normalizeRoom(row.homeRoom);
    const homeroomNew =
      !existingHomerooms.has(roomKey) && !plannedHomerooms.has(roomKey);
    if (homeroomNew) {
      plannedHomerooms.add(roomKey);
      newHomerooms.push(row.homeRoom);
    }
    return {
      ...row,
      status: existingEmails.has(row.email) ? "existing" : "invite",
      homeroomNew,
    };
  });

  const inviteCount = previewRows.filter((r) => r.status === "invite").length;
  return {
    rows: previewRows,
    summary: {
      total: previewRows.length,
      inviteCount,
      existingCount: previewRows.length - inviteCount,
      newHomerooms: newHomerooms.length,
    },
    newHomerooms,
  };
}

export type TeacherApplyOutcome = {
  row: number;
  email: string;
  result: "invited" | "existing" | "failed";
};

export type TeacherApplySummary = {
  invited: number;
  existing: number;
  failed: number;
  teachersCreated: number;
  outcomes: TeacherApplyOutcome[];
};

export type TeacherWritePrisma = {
  teacher: {
    findMany: (args: { select: { homeRoom: true } }) => Promise<{ homeRoom: string }[]>;
    createMany: (args: {
      data: { homeRoom: string; teacherName: string }[];
    }) => Promise<unknown>;
    updateMany: (args: {
      where: { homeRoom: string };
      data: { teacherName: string };
    }) => Promise<unknown>;
  };
};

/** Injected invite — returns the per-row outcome. Keeps auth/email out here. */
export type InviteTeacherFn = (
  row: TeacherImportRow,
) => Promise<"invited" | "existing" | "failed">;

/**
 * Apply a teacher import: ensure each homeroom's Teacher row exists (carrying
 * the teacher's name) and invite each teacher as a user. Partial success is
 * expected — a single failed invite (already-exists, bad email) does not abort
 * the batch; every row's outcome is reported back.
 */
/** Bound on concurrent invites — each is ~6 D1 round-trips, so we keep a few
 *  in flight without flooding the Worker's subrequest budget. */
const INVITE_CONCURRENCY = 8;

export async function applyTeacherImport(
  prisma: TeacherWritePrisma,
  rows: TeacherImportRow[],
  invite: InviteTeacherFn,
): Promise<TeacherApplySummary> {
  const existing = await prisma.teacher.findMany({ select: { homeRoom: true } });
  const existingRooms = new Set(existing.map((t) => normalizeRoom(t.homeRoom)));

  // Collapse rows to one entry per homeroom, last row winning the teacher name
  // (the previous per-row updateMany loop had the same last-write-wins effect).
  const roomByKey = new Map<string, { homeRoom: string; teacherName: string }>();
  for (const row of rows) {
    roomByKey.set(normalizeRoom(row.homeRoom), {
      homeRoom: row.homeRoom,
      teacherName: row.name,
    });
  }
  const newRooms: { homeRoom: string; teacherName: string }[] = [];
  const updateRooms: { homeRoom: string; teacherName: string }[] = [];
  for (const [key, room] of roomByKey) {
    (existingRooms.has(key) ? updateRooms : newRooms).push(room);
  }

  // Batch the homeroom writes: a single createMany for new rooms, and the
  // existing-room name refreshes in parallel — instead of one round-trip per
  // row interleaved with the invites.
  await Promise.all([
    newRooms.length
      ? prisma.teacher.createMany({ data: newRooms })
      : Promise.resolve(),
    ...updateRooms.map((r) =>
      prisma.teacher.updateMany({
        where: { homeRoom: r.homeRoom },
        data: { teacherName: r.teacherName },
      }),
    ),
  ]);
  const teachersCreated = newRooms.length;

  // Invites dominate the cost (~6 round-trips each). Run them in bounded
  // concurrent batches rather than strictly sequentially. Emails were already
  // deduped upstream (applyTeacherMapping), so concurrent invites can't race on
  // the same address. A throwing invite is treated as "failed" so one bad row
  // never aborts the batch.
  const outcomes: TeacherApplyOutcome[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i += INVITE_CONCURRENCY) {
    const batch = rows.slice(i, i + INVITE_CONCURRENCY);
    const results = await Promise.all(
      batch.map((row) =>
        invite(row).catch(() => "failed" as const),
      ),
    );
    results.forEach((result, j) => {
      const row = batch[j];
      outcomes[i + j] = { row: row.rowNumber, email: row.email, result };
    });
  }

  return {
    invited: outcomes.filter((o) => o.result === "invited").length,
    existing: outcomes.filter((o) => o.result === "existing").length,
    failed: outcomes.filter((o) => o.result === "failed").length,
    teachersCreated,
    outcomes,
  };
}

const serializedTeacherRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  name: z.string().trim().min(1),
  email: z.string().trim().min(1),
  homeRoom: z.string().trim().min(1),
  role: z.enum(["VIEWER", "CONTROLLER"]),
});

const serializedTeacherRowsSchema = z.array(serializedTeacherRowSchema);

export function serializeTeacherRows(rows: TeacherImportRow[]): string {
  return JSON.stringify(rows);
}

export function parseSerializedTeacherRows(
  value: FormDataEntryValue | null,
): TeacherImportRow[] {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("teacherImport.previewMissing");
  }
  return serializedTeacherRowsSchema.parse(JSON.parse(value));
}
