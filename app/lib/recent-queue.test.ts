import test from "node:test";
import assert from "node:assert/strict";
import {
  callVisibleInRecentQueue,
  decorateRecentQueueEvents,
  formatStudentCallName,
  householdCallSpaceNumbers,
  recentQueueLabel,
} from "./recent-queue";

test("formatStudentCallName matches the single-student snapshot", () => {
  assert.equal(
    formatStudentCallName({ firstName: "Aarav", lastName: "Banerjee", suffix: null }),
    "Aarav Banerjee",
  );
  assert.equal(
    formatStudentCallName({ firstName: "Aarav", lastName: "Banerjee", suffix: "Jr" }),
    "Aarav Banerjee Jr",
  );
});

test("single-student calls keep the stored name", () => {
  assert.equal(
    recentQueueLabel({
      studentId: 12,
      studentName: "Aarav Banerjee",
      students: [{ firstName: "Ignored", lastName: "Sibling" }],
    }),
    "Aarav Banerjee",
  );
});

test("household calls show the stored name and the children's names", () => {
  assert.equal(
    recentQueueLabel({
      studentId: null,
      studentName: "Banerjee family",
      students: [
        { firstName: "Meera", lastName: "Banerjee" },
        { firstName: "Aarav", lastName: "Banerjee", suffix: null },
      ],
    }),
    "Banerjee family (Aarav Banerjee, Meera Banerjee)",
  );
});

test("household calls with no resolvable children keep the stored name", () => {
  assert.equal(
    recentQueueLabel({
      studentId: null,
      studentName: "Banerjee family",
      students: [],
    }),
    "Banerjee family",
  );
  assert.equal(
    recentQueueLabel({
      studentId: null,
      studentName: "Space 4",
      students: [],
    }),
    "Space 4",
  );
});

test("decorateRecentQueueEvents leaves single-student rows alone and labels siblings", () => {
  const studentsBySpace = new Map([
    [
      7,
      [
        { firstName: "Meera", lastName: "Banerjee" },
        { firstName: "Aarav", lastName: "Banerjee" },
      ],
    ],
  ]);
  const decorated = decorateRecentQueueEvents(
    [
      {
        id: 1,
        studentId: 3,
        studentName: "Sam Lee",
        spaceNumber: 2,
        homeRoomSnapshot: "Lee",
      },
      {
        id: 2,
        studentId: null,
        studentName: "Banerjee family",
        spaceNumber: 7,
        homeRoomSnapshot: null,
      },
    ],
    studentsBySpace,
  );
  assert.equal(decorated[0]?.studentName, "Sam Lee");
  assert.equal(
    decorated[1]?.studentName,
    "Banerjee family (Aarav Banerjee, Meera Banerjee)",
  );
});

test("householdCallSpaceNumbers collects only null-studentId spaces", () => {
  assert.deepEqual(
    householdCallSpaceNumbers([
      { studentId: 1, spaceNumber: 2 },
      { studentId: null, spaceNumber: 7 },
      { studentId: null, spaceNumber: 7 },
      { studentId: null, spaceNumber: 9 },
    ]),
    [7, 9],
  );
});

test("the live broadcast label matches the label rebuilt on load", () => {
  const students = [
    { firstName: "Meera", lastName: "Banerjee" },
    { firstName: "Aarav", lastName: "Banerjee" },
  ];
  const storedName = "Banerjee family";
  const live = recentQueueLabel({
    studentId: null,
    studentName: storedName,
    students,
  });
  const [reloaded] = decorateRecentQueueEvents(
    [{ studentId: null, studentName: storedName, spaceNumber: 4 }],
    new Map([[4, students]]),
  );
  assert.equal(live, reloaded?.studentName);
  assert.equal(live, "Banerjee family (Aarav Banerjee, Meera Banerjee)");
});

test("sibling calls stay in the unfiltered queue and honor the homeroom filter", () => {
  const sibling = { homeRoomSnapshot: null as string | null };
  const solo = { homeRoomSnapshot: "Bishop" };
  assert.equal(callVisibleInRecentQueue(sibling, []), true);
  assert.equal(callVisibleInRecentQueue(solo, []), true);
  assert.equal(callVisibleInRecentQueue(sibling, ["Bishop"]), false);
  assert.equal(callVisibleInRecentQueue(solo, ["Bishop"]), true);
  assert.equal(callVisibleInRecentQueue(solo, ["Lee"]), false);
});
