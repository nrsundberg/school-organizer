/**
 * Pure helpers for the children/classroom admin pages. Stays free of server
 * imports so React Router's bundler ships it to the client without tripping
 * the "server module referenced by client" guard. Server-side fetchers live
 * in `grade.server.ts` next to this file.
 */

export const GRADE_LEVELS = [
  "PRE_K",
  "K",
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "G6",
  "G7",
  "G8",
  "G9",
  "G10",
  "G11",
  "G12",
  "OTHER",
] as const;

export type GradeLevel = (typeof GRADE_LEVELS)[number];

export function isGradeLevel(value: unknown): value is GradeLevel {
  return typeof value === "string" && (GRADE_LEVELS as readonly string[]).includes(value);
}

/** Display label for a grade enum, used in pills, section headers, selects. */
export function gradeLabel(grade: GradeLevel | null | undefined): string {
  switch (grade) {
    case "PRE_K":
      return "Pre-K";
    case "K":
      return "Kindergarten";
    case "OTHER":
      return "Other";
    case null:
    case undefined:
      return "Ungraded";
    default:
      // G1..G12 → "1st grade" etc. via a tiny ordinal suffix.
      return `${gradeOrdinalNumber(grade)}${ordinalSuffix(gradeOrdinalNumber(grade))} grade`;
  }
}

/** Compact label used in pill bars where space is tight. */
export function gradeShortLabel(grade: GradeLevel | null | undefined): string {
  switch (grade) {
    case "PRE_K":
      return "Pre-K";
    case "K":
      return "K";
    case "OTHER":
      return "Other";
    case null:
    case undefined:
      return "Ungraded";
    default:
      return grade.replace(/^G/, ""); // G1 → "1"
  }
}

function gradeOrdinalNumber(grade: GradeLevel): number {
  if (grade === "K") return 0;
  if (grade === "PRE_K") return -1;
  if (grade === "OTHER") return 99;
  return Number(grade.replace(/^G/, ""));
}

function ordinalSuffix(n: number): string {
  if (n <= 0) return "";
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** Sort key — lower comes first. Ungraded goes last. */
export function gradeSortIndex(grade: GradeLevel | null | undefined): number {
  if (grade == null) return 1000; // Ungraded → tail
  const idx = (GRADE_LEVELS as readonly string[]).indexOf(grade);
  return idx === -1 ? 999 : idx;
}

export type ClassroomLike = {
  id: number;
  homeRoom: string;
  gradeLevel: GradeLevel | null;
  capacity: number | null;
  studentCount: number;
};

export type GradeBucket = {
  grade: GradeLevel | null;
  classrooms: ClassroomLike[];
  classroomCount: number;
  studentCount: number;
};

/**
 * Group classrooms by their gradeLevel for the index-page rendering. Returns
 * buckets in display order (Pre-K → 12 → Other → Ungraded). Pure — does
 * NOT touch the DB. Used in the loader after fetching classrooms.
 */
export function groupClassroomsByGrade<T extends ClassroomLike>(
  classrooms: T[],
): { grade: GradeLevel | null; classrooms: T[]; classroomCount: number; studentCount: number }[] {
  const map = new Map<string, { grade: GradeLevel | null; classrooms: T[] }>();
  for (const c of classrooms) {
    const key = c.gradeLevel ?? "__UNGRADED__";
    const bucket = map.get(key) ?? { grade: c.gradeLevel ?? null, classrooms: [] };
    bucket.classrooms.push(c);
    map.set(key, bucket);
  }
  return Array.from(map.values())
    .map((b) => ({
      grade: b.grade,
      classrooms: b.classrooms,
      classroomCount: b.classrooms.length,
      studentCount: b.classrooms.reduce((acc, c) => acc + c.studentCount, 0),
    }))
    .sort((a, b) => gradeSortIndex(a.grade) - gradeSortIndex(b.grade));
}

/**
 * Compute the set of distinct populated grade values plus the count of
 * students in each — drives the grade pill bar at the top of the index.
 * Includes a synthetic "ungraded" entry only when at least one classroom
 * is missing a grade.
 */
export function gradeFilterCounts<T extends ClassroomLike>(
  classrooms: T[],
): { grade: GradeLevel | null; studentCount: number; classroomCount: number }[] {
  const buckets = groupClassroomsByGrade(classrooms);
  return buckets.map((b) => ({
    grade: b.grade,
    studentCount: b.studentCount,
    classroomCount: b.classroomCount,
  }));
}

/**
 * Identify students whose `homeRoom` doesn't match any Teacher row. These
 * are the "unassigned students" callout on the stats row. We accept the raw
 * student rows + a Set of valid homeRoom strings so the helper stays pure
 * (no DB).
 */
export function findUnassignedStudents<
  S extends { id: number; homeRoom: string | null },
>(students: S[], validHomeRooms: Set<string>): S[] {
  return students.filter((s) => {
    if (!s.homeRoom) return true; // null homeRoom → unassigned
    return !validHomeRooms.has(s.homeRoom);
  });
}

export type ClassFillState = "empty" | "filling" | "near-cap" | "over-cap";

/** Default capacity used when Teacher.capacity is null. Tweak in one place. */
export const DEFAULT_CLASSROOM_CAPACITY = 22;

export function classroomFillState(
  studentCount: number,
  capacity: number | null,
): ClassFillState {
  const cap = capacity ?? DEFAULT_CLASSROOM_CAPACITY;
  if (studentCount === 0) return "empty";
  const ratio = studentCount / cap;
  if (ratio > 1) return "over-cap";
  if (ratio >= 0.9) return "near-cap";
  return "filling";
}

export function classroomFillRatio(
  studentCount: number,
  capacity: number | null,
): number {
  const cap = capacity ?? DEFAULT_CLASSROOM_CAPACITY;
  if (cap <= 0) return 0;
  return Math.min(1, studentCount / cap);
}
