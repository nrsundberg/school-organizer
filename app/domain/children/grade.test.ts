import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classroomFillRatio,
  classroomFillState,
  findUnassignedStudents,
  gradeFilterCounts,
  gradeLabel,
  gradeShortLabel,
  gradeSortIndex,
  groupClassroomsByGrade,
  isGradeLevel,
} from "./grade";

test("isGradeLevel narrows to known enum values", () => {
  assert.equal(isGradeLevel("K"), true);
  assert.equal(isGradeLevel("G5"), true);
  assert.equal(isGradeLevel("PRE_K"), true);
  assert.equal(isGradeLevel("OTHER"), true);
  assert.equal(isGradeLevel("nope"), false);
  assert.equal(isGradeLevel(""), false);
  assert.equal(isGradeLevel(null), false);
});

test("gradeLabel renders ordinal names for G1..G12", () => {
  assert.equal(gradeLabel("PRE_K"), "Pre-K");
  assert.equal(gradeLabel("K"), "Kindergarten");
  assert.equal(gradeLabel("G1"), "1st grade");
  assert.equal(gradeLabel("G2"), "2nd grade");
  assert.equal(gradeLabel("G3"), "3rd grade");
  assert.equal(gradeLabel("G4"), "4th grade");
  assert.equal(gradeLabel("G11"), "11th grade");
  assert.equal(gradeLabel("G12"), "12th grade");
  assert.equal(gradeLabel("OTHER"), "Other");
  assert.equal(gradeLabel(null), "Ungraded");
  assert.equal(gradeLabel(undefined), "Ungraded");
});

test("gradeShortLabel emits compact pill labels", () => {
  assert.equal(gradeShortLabel("K"), "K");
  assert.equal(gradeShortLabel("G5"), "5");
  assert.equal(gradeShortLabel("PRE_K"), "Pre-K");
  assert.equal(gradeShortLabel("OTHER"), "Other");
  assert.equal(gradeShortLabel(null), "Ungraded");
});

test("gradeSortIndex orders Pre-K -> Other -> Ungraded", () => {
  const grades = ["G3", null, "K", "OTHER", "PRE_K", "G1"] as const;
  const sorted = [...grades].sort(
    (a, b) => gradeSortIndex(a) - gradeSortIndex(b),
  );
  assert.deepEqual(sorted, ["PRE_K", "K", "G1", "G3", "OTHER", null]);
});

test("groupClassroomsByGrade buckets + sorts + sums", () => {
  const rooms = [
    { id: 1, homeRoom: "K-1", gradeLevel: "K" as const,  capacity: 22, studentCount: 18 },
    { id: 2, homeRoom: "1A",  gradeLevel: "G1" as const, capacity: 22, studentCount: 21 },
    { id: 3, homeRoom: "K-2", gradeLevel: "K" as const,  capacity: 22, studentCount: 17 },
    { id: 4, homeRoom: "Mix", gradeLevel: null,          capacity: null, studentCount: 4 },
    { id: 5, homeRoom: "1B",  gradeLevel: "G1" as const, capacity: 22, studentCount: 20 },
  ];
  const groups = groupClassroomsByGrade(rooms);
  assert.deepEqual(
    groups.map((g) => g.grade),
    ["K", "G1", null],
    "K -> G1 -> Ungraded",
  );
  const k = groups.find((g) => g.grade === "K")!;
  assert.equal(k.classroomCount, 2);
  assert.equal(k.studentCount, 35);
  const g1 = groups.find((g) => g.grade === "G1")!;
  assert.equal(g1.classroomCount, 2);
  assert.equal(g1.studentCount, 41);
  const ungraded = groups.find((g) => g.grade === null)!;
  assert.equal(ungraded.classroomCount, 1);
  assert.equal(ungraded.studentCount, 4);
});

test("gradeFilterCounts returns one entry per populated grade", () => {
  const counts = gradeFilterCounts([
    { id: 1, homeRoom: "K-1", gradeLevel: "K" as const, capacity: 22, studentCount: 5 },
    { id: 2, homeRoom: "Mix", gradeLevel: null, capacity: null, studentCount: 0 },
  ]);
  assert.equal(counts.length, 2);
  assert.equal(counts[0]!.grade, "K");
  assert.equal(counts[0]!.studentCount, 5);
  assert.equal(counts[1]!.grade, null);
});

test("findUnassignedStudents catches null + stale homeRoom", () => {
  const validRooms = new Set(["K-1", "1A"]);
  const students = [
    { id: 1, homeRoom: "K-1" },             // assigned
    { id: 2, homeRoom: null },              // null → unassigned
    { id: 3, homeRoom: "Old-Room-2024" },   // stale → unassigned
    { id: 4, homeRoom: "1A" },              // assigned
  ];
  const unassigned = findUnassignedStudents(students, validRooms);
  assert.deepEqual(unassigned.map((s) => s.id), [2, 3]);
});

test("classroomFillState classifies empty/filling/near-cap/over-cap", () => {
  assert.equal(classroomFillState(0, 22), "empty");
  assert.equal(classroomFillState(10, 22), "filling");
  assert.equal(classroomFillState(20, 22), "near-cap"); // 20/22 = 0.909..
  assert.equal(classroomFillState(22, 22), "near-cap");
  assert.equal(classroomFillState(23, 22), "over-cap");
  // null capacity → uses DEFAULT_CLASSROOM_CAPACITY (22)
  assert.equal(classroomFillState(0, null), "empty");
  assert.equal(classroomFillState(25, null), "over-cap");
});

test("classroomFillRatio is bounded to [0, 1]", () => {
  assert.equal(classroomFillRatio(0, 20), 0);
  assert.equal(classroomFillRatio(10, 20), 0.5);
  assert.equal(classroomFillRatio(40, 20), 1, "clamps at 1.0");
  assert.equal(classroomFillRatio(11, null), 0.5);
});
