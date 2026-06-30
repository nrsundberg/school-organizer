/**
 * Regression test: siblings sharing a pickup space must land in ONE household.
 * The original importer created households inside a `Promise.all` chunk, so
 * concurrent getOrCreateHousehold calls each saw "no household yet" and each
 * created a duplicate. This test reproduces that interleaving with a fake
 * prisma whose findFirst/create resolve on a microtask.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { applyRosterImport, type RosterImportRow, type RosterPrisma } from "./roster-import.server";

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

  const prisma: RosterPrisma = {
    student: {
      findMany: async () => existing.students ?? [],
      createMany: async ({ data }) => {
        createdStudents.push(...data);
        return {};
      },
      update: async () => ({}),
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

  return { prisma, createdHouseholds, createdStudents };
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
