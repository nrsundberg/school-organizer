/**
 * Regression test: siblings sharing a pickup space must land in ONE household.
 * The original importer created households inside a `Promise.all` chunk, so
 * concurrent getOrCreateHousehold calls each saw "no household yet" and each
 * created a duplicate. This test reproduces that interleaving with a fake
 * prisma whose findFirst/create resolve on a microtask.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRosterImport,
  buildRosterImportPlan,
  type ExistingRosterSnapshot,
  type RosterImportRow,
  type RosterPrisma,
} from "./roster-import.server";

type ExistingSnapshot = {
  students?: {
    id: number;
    firstName: string;
    lastName: string;
    homeRoom: string | null;
    household: { spaceNumber: number | null } | null;
  }[];
  teachers?: { homeRoom: string }[];
  spaces?: { spaceNumber: number }[];
};

function makeFakePrisma(existing: ExistingSnapshot = {}) {
  const committed = new Map<number, string>(); // spaceNumber -> household id
  let hCounter = 0;
  const createdHouseholds: { spaceNumber: number; name: string; id: string }[] = [];
  const createdStudents: {
    firstName: string;
    lastName: string;
    homeRoom: string | null;
    householdId: string | null;
  }[] = [];
  const deletedStudentIds: number[] = [];

  const prisma: RosterPrisma = {
    student: {
      findMany: async () => existing.students ?? [],
      createMany: async ({ data }) => {
        createdStudents.push(...data);
        return {};
      },
      update: async () => ({}),
      deleteMany: async ({ where }) => {
        deletedStudentIds.push(...where.id.in);
        return {};
      },
    },
    teacher: {
      findMany: async () => existing.teachers ?? [],
      createMany: async () => ({}),
    },
    space: {
      findMany: async () => existing.spaces ?? [],
      createMany: async () => ({}),
    },
    household: {
      findMany: async ({ where }) => {
        await Promise.resolve(); // force interleaving
        return where.spaceNumber.in
          .filter((sn) => committed.has(sn))
          .map((sn) => ({ id: committed.get(sn)!, spaceNumber: sn }));
      },
      createManyAndReturn: async ({ data }) => {
        await Promise.resolve();
        return data.map((d) => {
          const id = `h${++hCounter}`;
          committed.set(d.spaceNumber, id);
          createdHouseholds.push({ ...d, id });
          return { id, spaceNumber: d.spaceNumber };
        });
      },
    },
  };

  return { prisma, createdHouseholds, createdStudents, deletedStudentIds };
}

function row(rowNumber: number, firstName: string, lastName: string, spaceNumber: number | null): RosterImportRow {
  return { rowNumber, firstName, lastName, homeRoom: `Room ${spaceNumber ?? "X"}`, spaceNumber };
}

test("applyRosterImport: siblings on one space share a single household", async () => {
  const { prisma, createdHouseholds, createdStudents } = makeFakePrisma();
  const rows: RosterImportRow[] = [
    row(2, "Ada", "Lovelace", 12),
    row(3, "Bob", "Lovelace", 12),
    row(4, "Cy", "Lovelace", 12),
  ];

  const result = await applyRosterImport(prisma, rows);

  assert.equal(result.ok, true);
  assert.equal(createdHouseholds.length, 1, "exactly one household for space 12");
  const ids = new Set(createdStudents.map((s) => s.householdId));
  assert.equal(ids.size, 1, "all three students share one householdId");
  assert.equal([...ids][0], createdHouseholds[0].id);
});

test("applyRosterImport: different last names on one space still share a household", async () => {
  const { prisma, createdHouseholds } = makeFakePrisma();
  const rows: RosterImportRow[] = [
    row(2, "Ada", "Lovelace", 12),
    row(3, "Bob", "Hopper", 12),
  ];

  const result = await applyRosterImport(prisma, rows);

  assert.equal(result.ok, true);
  assert.equal(createdHouseholds.length, 1, "space-only dedup: one household");
});

test("applyRosterImport: null space yields null householdId", async () => {
  const { prisma, createdHouseholds, createdStudents } = makeFakePrisma();
  const result = await applyRosterImport(prisma, [row(2, "Ada", "Lovelace", null)]);

  assert.equal(result.ok, true);
  assert.equal(createdHouseholds.length, 0);
  assert.equal(createdStudents[0].householdId, null);
});

function snapshot(
  students: ExistingRosterSnapshot["students"],
): ExistingRosterSnapshot {
  return { students, teachers: [], spaces: [] };
}

test("buildRosterImportPlan: flags students absent from the CSV as removals", () => {
  const plan = buildRosterImportPlan(
    [row(2, "Ada", "Lovelace", 12)],
    snapshot([
      { id: 1, firstName: "Ada", lastName: "Lovelace", homeRoom: "Room 12", spaceNumber: 12 },
      { id: 2, firstName: "Grace", lastName: "Hopper", homeRoom: "Room 9", spaceNumber: 9 },
    ]),
  );

  assert.equal(plan.summary.removeCount, 1);
  assert.deepEqual(
    plan.removals.map((r) => r.studentId),
    [2],
    "only the student missing from the CSV is a removal",
  );
});

test("buildRosterImportPlan: a student who changed homeroom is NOT a removal", () => {
  // The regression this whole design exists to prevent. `rosterKey` includes
  // homeRoom, so Ada reads as "new" here — but she is plainly still enrolled,
  // and deleting her would orphan her CallEvent history.
  const plan = buildRosterImportPlan(
    [{ rowNumber: 2, firstName: "Ada", lastName: "Lovelace", homeRoom: "Room 99", spaceNumber: 12 }],
    snapshot([
      { id: 1, firstName: "Ada", lastName: "Lovelace", homeRoom: "Room 12", spaceNumber: 12 },
    ]),
  );

  assert.equal(plan.summary.removeCount, 0);
  assert.deepEqual(plan.removals, []);
});

test("buildRosterImportPlan: removal matching ignores case and surrounding space", () => {
  const plan = buildRosterImportPlan(
    [{ rowNumber: 2, firstName: "  ADA ", lastName: "lovelace", homeRoom: "Room 12", spaceNumber: 12 }],
    snapshot([
      { id: 1, firstName: "Ada", lastName: "Lovelace", homeRoom: "Room 12", spaceNumber: 12 },
    ]),
  );

  assert.equal(plan.summary.removeCount, 0);
});

test("buildRosterImportPlan: an empty roster yields no removals", () => {
  const plan = buildRosterImportPlan([], snapshot([]));
  assert.equal(plan.summary.removeCount, 0);
  assert.deepEqual(plan.removals, []);
});

const EXISTING_GRACE: ExistingRosterSnapshot["students"] = [
  { id: 7, firstName: "Grace", lastName: "Hopper", homeRoom: "Room 9", spaceNumber: 9 },
];

test("applyRosterImport: does NOT delete when prune is not requested", async () => {
  const { prisma, deletedStudentIds } = makeFakePrisma({
    students: EXISTING_GRACE.map((s) => ({ ...s, household: { spaceNumber: s.spaceNumber } })),
  });

  const result = await applyRosterImport(prisma, [row(2, "Ada", "Lovelace", 12)]);

  assert.equal(result.ok, true);
  assert.deepEqual(deletedStudentIds, [], "a plain re-import is never destructive");
  assert.equal(result.ok && result.data.removed, 0);
});

test("applyRosterImport: deletes absent students when prune is requested", async () => {
  const { prisma, deletedStudentIds } = makeFakePrisma({
    students: EXISTING_GRACE.map((s) => ({ ...s, household: { spaceNumber: s.spaceNumber } })),
  });

  const result = await applyRosterImport(
    prisma,
    [row(2, "Ada", "Lovelace", 12)],
    undefined,
    { prune: true },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(deletedStudentIds, [7]);
  assert.equal(result.ok && result.data.removed, 1);
});

test("applyRosterImport: prune with nothing to remove issues no delete", async () => {
  const { prisma, deletedStudentIds } = makeFakePrisma();

  const result = await applyRosterImport(
    prisma,
    [row(2, "Ada", "Lovelace", 12)],
    undefined,
    { prune: true },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(deletedStudentIds, []);
  assert.equal(result.ok && result.data.removed, 0);
});
