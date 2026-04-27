// app/domain/drills/clone.server.ts
//
// Server-only helper for cloning a globally-seeded drill template into an
// org's own DrillTemplate table. Used by the library picker route action and
// (potentially) future bulk-clone tooling, so the create logic only lives in
// one place.

import type { PrismaClient } from "~/db";
import { getGlobalTemplate } from "./library";
import type { ColumnDef, RowDef, TemplateDefinition } from "./types";

/**
 * Minimal teacher shape this module needs. We accept anything with a
 * `homeRoom` (canonical case) so tests don't need to drag in the full
 * Prisma `Teacher` type.
 */
export interface TeacherForClone {
  id: number;
  homeRoom: string;
}

const TEACHER_COLUMN_ID = "teacher";
const TEACHER_COLUMN_LABEL = "teacher";
const CLASS_ROLL_SECTION_ID = "class-roll";

// Column id heuristics for "the column that holds the grade/class label".
// Order matters — we pick the first match, so prefer the more specific ids.
const GRADE_COLUMN_IDS = ["grade", "class"];
const GRADE_COLUMN_LABEL_RE = /grade|class/i;

/**
 * True when the column is the "Teacher" column we should fan out into.
 * We accept either id="teacher" or label="Teacher" (case-insensitive) so a
 * future template with a different id (e.g. "lead-teacher") still works as
 * long as it's labeled Teacher.
 */
function isTeacherColumn(c: ColumnDef): boolean {
  return (
    c.id === TEACHER_COLUMN_ID ||
    c.label.trim().toLowerCase() === TEACHER_COLUMN_LABEL
  );
}

/** First column whose id or label looks grade-ish. */
function findGradeColumn(columns: ColumnDef[]): ColumnDef | undefined {
  for (const id of GRADE_COLUMN_IDS) {
    const hit = columns.find((c) => c.id === id);
    if (hit) return hit;
  }
  return columns.find((c) => GRADE_COLUMN_LABEL_RE.test(c.label));
}

/**
 * Determine which rows in this definition are part of the "class-roll" group
 * we want to fan out. Three cases:
 *   - No `sections` at all → all rows count, but ONLY if the definition has
 *     a Teacher column. (Otherwise this isn't a class-roll template.)
 *   - Has a `class-roll` section → only rows with that sectionId count.
 *   - Multi-section but no `class-roll` → no fan-out (the template is staff-
 *     actions only, like bus-evacuation's driver-actions block).
 */
function classRollRowIndexes(def: TemplateDefinition): number[] {
  const teacherCol = def.columns.find(isTeacherColumn);
  if (!teacherCol) return [];

  if (!def.sections || def.sections.length === 0) {
    return def.rows.map((_, i) => i);
  }

  const hasClassRollSection = def.sections.some(
    (s) => s.id === CLASS_ROLL_SECTION_ID,
  );
  if (!hasClassRollSection) return [];

  const out: number[] = [];
  def.rows.forEach((r, i) => {
    if (r.sectionId === CLASS_ROLL_SECTION_ID) out.push(i);
  });
  return out;
}

/**
 * Try to parse a grade label out of a homeRoom string. Examples that should
 * map cleanly:
 *   "Smith - K"        → "K"
 *   "Smith K"          → "K"
 *   "Mrs. Smith (3)"   → "3"
 *   "1st Grade Jones"  → "1"
 *   "Kindergarten - J" → "K"
 *   "Pre-K Smith"      → "Pre-K"
 * Anything we can't confidently parse just returns null and the caller
 * falls back to using the homeRoom verbatim in the grade cell.
 */
function deriveGradeFromHomeRoom(homeRoom: string): string | null {
  const s = homeRoom.trim();
  if (!s) return null;

  // Pre-K is a common label and would otherwise get caught by the "K" rule.
  if (/\bpre[\s-]?k\b/i.test(s)) return "Pre-K";

  // Kindergarten / standalone K
  if (/\bkindergarten\b/i.test(s)) return "K";
  if (/(^|[^a-z])k($|[^a-z])/i.test(s)) return "K";

  // "1st Grade", "2nd grade", etc.
  const ordinal = s.match(/(\d+)(?:st|nd|rd|th)?\s*grade/i);
  if (ordinal) return ordinal[1];

  // Bare digit, e.g. "Smith 3" or "Smith - 3" or "Smith (3)"
  const bare = s.match(/(?:^|[\s\-(])(\d{1,2})(?:[\s)]|$)/);
  if (bare) return bare[1];

  return null;
}

/**
 * Build the fanned-out class-roll rows from the org's teacher list. Each row
 * gets a stable id (`teacher-${id}`), the teacher's homeRoom in the Teacher
 * cell, and a best-effort grade in the grade cell (falling back to the
 * homeRoom string itself when the grade can't be parsed). All other text
 * cells are seeded blank — `parseTemplateDefinition` would do this anyway,
 * but we do it here too so the JSON written to the DB is self-describing.
 */
function buildTeacherRows(
  def: TemplateDefinition,
  templateRow: RowDef | undefined,
  teachers: TeacherForClone[],
): RowDef[] {
  const teacherCol = def.columns.find(isTeacherColumn);
  if (!teacherCol) return [];
  const gradeCol = findGradeColumn(def.columns);
  const textColIds = def.columns.filter((c) => c.kind === "text").map((c) => c.id);

  return teachers.map((t) => {
    // Start from the first class-roll row's cells so column-specific defaults
    // like assembly-point="Field A" are preserved per teacher. Fall back to
    // empty cells when the section had no template row (shouldn't happen in
    // practice but keep the fan-out total).
    const baseCells: Record<string, string> = templateRow
      ? { ...templateRow.cells }
      : {};
    for (const colId of textColIds) {
      if (baseCells[colId] === undefined) baseCells[colId] = "";
    }

    baseCells[teacherCol.id] = t.homeRoom;
    if (gradeCol) {
      const derived = deriveGradeFromHomeRoom(t.homeRoom);
      baseCells[gradeCol.id] = derived ?? t.homeRoom;
    }

    const row: RowDef = {
      id: `teacher-${t.id}`,
      cells: baseCells,
    };
    if (templateRow?.sectionId) row.sectionId = templateRow.sectionId;
    return row;
  });
}

/**
 * Replace the class-roll rows of `def` with one row per teacher. Returns a
 * new definition; the input is not mutated.
 *
 * If the org has zero teachers we return the original definition unchanged
 * — better to keep the hardcoded K/1/2/.../Specials rows than show an empty
 * table on the very first clone before homerooms are seeded.
 *
 * Exported for testing.
 */
export function fanOutClassRollWithTeachers(
  def: TemplateDefinition,
  teachers: TeacherForClone[],
): TemplateDefinition {
  // Edge case: zero teachers in the org → fall back to the library's
  // hardcoded grade rows so the cloned template never lands as an empty
  // table. The admin can re-clone (or future "Refresh teachers" button)
  // once homerooms exist.
  if (teachers.length === 0) return def;

  const rollIndexes = classRollRowIndexes(def);
  if (rollIndexes.length === 0) return def;

  // Use the first roll row as the prototype for cells (preserves things
  // like assembly-point="Field A").
  const prototype = def.rows[rollIndexes[0]];
  const newRollRows = buildTeacherRows(def, prototype, teachers);

  // Splice: keep all non-class-roll rows in their original positions, drop
  // the original class-roll rows, and append the new teacher rows where the
  // first class-roll row used to be.
  const rollSet = new Set(rollIndexes);
  const firstRollIdx = rollIndexes[0];
  const out: RowDef[] = [];
  for (let i = 0; i < def.rows.length; i++) {
    if (i === firstRollIdx) {
      out.push(...newRollRows);
    }
    if (rollSet.has(i)) continue;
    out.push(def.rows[i]);
  }

  return { ...def, rows: out };
}

/**
 * Clone a global library template (matched by `globalKey`) into an org's
 * `DrillTemplate` table.
 *
 * The template's `definition` is deep-cloned via `JSON.parse(JSON.stringify(...))`
 * before insert so that any later mutation of the inserted row (or in-memory
 * edits) cannot leak back into the shared `GLOBAL_TEMPLATES` constant.
 *
 * After the deep-clone, class-roll rows are fanned out to one row per Teacher
 * in the org so admins don't have to retype "Mrs. Smith / K" every time.
 * Non-class-roll sections (staff-actions, driver-actions, perimeter checks,
 * etc.) are preserved verbatim. See `fanOutClassRollWithTeachers` for the
 * heuristics.
 *
 * Note: this helper does NOT enforce uniqueness. Callers that want
 * "no duplicates per org" semantics should query for an existing
 * `{ orgId, globalKey }` row first and surface a friendly message — see
 * `app/routes/admin/drills.library.tsx` for the canonical pattern.
 *
 * @param prisma   Tenant-scoped PrismaClient (from `getTenantPrisma`).
 * @param orgId    The org to attach the cloned template to.
 * @param globalKey Stable slug from the library (e.g. `"fire-evacuation"`).
 * @throws {Response} 404 if no library template matches `globalKey`.
 * @returns The newly-created DrillTemplate row.
 */
export async function cloneGlobalTemplateToOrg(
  prisma: PrismaClient,
  orgId: string,
  globalKey: string,
) {
  const source = getGlobalTemplate(globalKey);
  if (!source) {
    throw new Response(`Unknown global template: ${globalKey}`, { status: 404 });
  }

  // Deep-clone the definition so future mutations on the persisted row never
  // mutate the shared library constant.
  const cloned = JSON.parse(JSON.stringify(source.definition)) as TemplateDefinition;

  // Pull teachers tenant-scoped (the prisma extension already AND-injects the
  // request's orgId, but we pass orgId redundantly so this also works in
  // tests using a non-extended client).
  const teachers = await prisma.teacher.findMany({
    where: { orgId },
    select: { id: true, homeRoom: true },
    orderBy: { homeRoom: "asc" },
  });

  const definition = fanOutClassRollWithTeachers(cloned, teachers);

  const created = await prisma.drillTemplate.create({
    data: {
      orgId,
      name: source.name,
      drillType: source.drillType,
      authority: source.authority,
      instructions: source.instructions,
      globalKey: source.globalKey,
      definition: definition as unknown as object,
    },
  });

  return created;
}
