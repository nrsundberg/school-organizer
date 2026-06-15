import assert from "node:assert/strict";
import test from "node:test";
import { groupDuplicateHouseholds, type HouseholdLite } from "./merge.server";

function h(id: string, spaceNumber: number | null, createdAt: string): HouseholdLite {
  return { id, spaceNumber, createdAt: new Date(createdAt) };
}

test("groupDuplicateHouseholds: groups non-null spaces with >1 member", () => {
  const groups = groupDuplicateHouseholds([
    h("a", 12, "2026-01-01"),
    h("b", 12, "2026-01-02"),
    h("c", 13, "2026-01-01"), // singleton, excluded
    h("d", null, "2026-01-01"), // null space, excluded
    h("e", null, "2026-01-02"), // null space, excluded (nulls never group)
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((x) => x.id), ["a", "b"]);
});

test("groupDuplicateHouseholds: each group is ordered oldest-first (survivor first)", () => {
  const groups = groupDuplicateHouseholds([
    h("late", 5, "2026-03-01"),
    h("early", 5, "2026-01-01"),
    h("mid", 5, "2026-02-01"),
  ]);

  assert.deepEqual(groups[0].map((x) => x.id), ["early", "mid", "late"]);
});

test("groupDuplicateHouseholds: empty input -> no groups", () => {
  assert.deepEqual(groupDuplicateHouseholds([]), []);
});

import { mergeHouseholdGroup, type MergePrisma, type MergeHouseholdGroupInput } from "./merge.server";

function makeMergeFake() {
  const calls: string[] = [];
  const studentReassigned: { from: string; to: string }[] = [];
  const exceptionReassigned: { from: string; to: string }[] = [];
  let survivorUpdate: { id: string; data: unknown } | null = null;
  let deleted: string[] = [];

  const prisma: MergePrisma = {
    student: {
      updateMany: async ({ where, data }) => {
        calls.push("student.updateMany");
        studentReassigned.push({ from: where.householdId, to: data.householdId });
        return {};
      },
    },
    dismissalException: {
      updateMany: async ({ where, data }) => {
        calls.push("dismissalException.updateMany");
        exceptionReassigned.push({ from: where.householdId, to: data.householdId });
        return {};
      },
    },
    household: {
      update: async ({ where, data }) => {
        calls.push("household.update");
        survivorUpdate = { id: where.id, data };
        return {};
      },
      deleteMany: async ({ where }) => {
        calls.push("household.deleteMany");
        deleted = where.id.in;
        return {};
      },
    },
  };

  return {
    prisma,
    get calls() {
      return calls;
    },
    get studentReassigned() {
      return studentReassigned;
    },
    get exceptionReassigned() {
      return exceptionReassigned;
    },
    get survivorUpdate() {
      return survivorUpdate;
    },
    get deleted() {
      return deleted;
    },
  };
}

const baseInput: MergeHouseholdGroupInput = {
  survivorId: "survivor",
  losingIds: ["lose1", "lose2"],
  scalars: {
    name: "Lovelace",
    pickupNotes: "side gate",
    primaryContactName: "Ada",
    primaryContactPhone: "555-0100",
  },
};

test("mergeHouseholdGroup: reassigns students + exceptions from each loser to survivor", async () => {
  const fake = makeMergeFake();
  await mergeHouseholdGroup(fake.prisma, baseInput);

  assert.deepEqual(fake.studentReassigned, [
    { from: "lose1", to: "survivor" },
    { from: "lose2", to: "survivor" },
  ]);
  assert.deepEqual(fake.exceptionReassigned, [
    { from: "lose1", to: "survivor" },
    { from: "lose2", to: "survivor" },
  ]);
});

test("mergeHouseholdGroup: writes chosen scalars to survivor and deletes losers", async () => {
  const fake = makeMergeFake();
  await mergeHouseholdGroup(fake.prisma, baseInput);

  assert.deepEqual(fake.survivorUpdate, { id: "survivor", data: baseInput.scalars });
  assert.deepEqual(fake.deleted, ["lose1", "lose2"]);
});

test("mergeHouseholdGroup: deletes losers only AFTER reassigning their rows", async () => {
  const fake = makeMergeFake();
  await mergeHouseholdGroup(fake.prisma, baseInput);

  const lastReassign = Math.max(
    fake.calls.lastIndexOf("student.updateMany"),
    fake.calls.lastIndexOf("dismissalException.updateMany"),
  );
  const deleteIdx = fake.calls.indexOf("household.deleteMany");
  assert.ok(deleteIdx > lastReassign, "deleteMany must run after all reassignments");
});
