import assert from "node:assert/strict";
import test from "node:test";
import {
  groupDuplicateStudents,
  mergeStudentGroup,
  studentDuplicateKey,
  type MergeStudentPrisma,
  type StudentScalars,
} from "./merge.server";

test("studentDuplicateKey: case- and whitespace-insensitive on name", () => {
  assert.equal(
    studentDuplicateKey({ firstName: " Ada ", lastName: "Lovelace" }),
    studentDuplicateKey({ firstName: "ada", lastName: "LOVELACE" }),
  );
});

test("groupDuplicateStudents: groups same-name students, ordered by id", () => {
  const groups = groupDuplicateStudents([
    { id: 3, firstName: "Ada", lastName: "Lovelace" },
    { id: 1, firstName: "ada", lastName: "lovelace" },
    { id: 2, firstName: "Grace", lastName: "Hopper" }, // unique → not a group
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].map((s) => s.id),
    [1, 3],
    "oldest (lowest id) first = default survivor",
  );
});

const scalars: StudentScalars = {
  firstName: "Ada",
  lastName: "Lovelace",
  suffix: null,
  homeRoom: "Room 101",
  householdId: "hh1",
};

function makeFake() {
  const calls: string[] = [];
  const studentReassigned: { from: number }[] = [];
  let updatedWith: StudentScalars | null = null;
  let deletedIds: number[] = [];

  const prisma: MergeStudentPrisma = {
    callEvent: {
      updateMany: async ({ where }) => {
        calls.push("callEvent.updateMany");
        studentReassigned.push({ from: where.studentId });
        return {};
      },
    },
    dismissalException: {
      updateMany: async ({ where }) => {
        calls.push("dismissalException.updateMany");
        studentReassigned.push({ from: where.studentId });
        return {};
      },
    },
    student: {
      update: async ({ data }) => {
        calls.push("student.update");
        updatedWith = data;
        return {};
      },
      deleteMany: async ({ where }) => {
        calls.push("student.deleteMany");
        deletedIds = where.id.in;
        return {};
      },
    },
  };

  return {
    prisma,
    calls,
    studentReassigned,
    get updatedWith() {
      return updatedWith;
    },
    get deletedIds() {
      return deletedIds;
    },
  };
}

test("mergeStudentGroup: reassigns call events + exceptions, then deletes losers", async () => {
  const fake = makeFake();
  await mergeStudentGroup(fake.prisma, {
    survivorId: 1,
    losingIds: [2, 3],
    scalars,
  });

  assert.deepEqual(fake.studentReassigned, [
    { from: 2 },
    { from: 2 },
    { from: 3 },
    { from: 3 },
  ]);
  assert.deepEqual(fake.updatedWith, scalars);
  assert.deepEqual(fake.deletedIds, [2, 3]);
});

test("mergeStudentGroup: deletes only AFTER all reassignments", async () => {
  const fake = makeFake();
  await mergeStudentGroup(fake.prisma, { survivorId: 1, losingIds: [2], scalars });

  const lastReassign = Math.max(
    fake.calls.lastIndexOf("callEvent.updateMany"),
    fake.calls.lastIndexOf("dismissalException.updateMany"),
  );
  const deleteIdx = fake.calls.indexOf("student.deleteMany");
  assert.ok(deleteIdx > lastReassign, "deleteMany must run after all reassignments");
});

test("mergeStudentGroup: never reassigns/deletes the survivor itself", async () => {
  const fake = makeFake();
  await mergeStudentGroup(fake.prisma, {
    survivorId: 1,
    losingIds: [1, 2], // survivor wrongly included
    scalars,
  });
  assert.deepEqual(fake.deletedIds, [2], "survivor filtered out of deletes");
  assert.ok(!fake.studentReassigned.some((r) => r.from === 1));
});
