import test from "node:test";
import assert from "node:assert/strict";
import {
  findLinkedAdminUser,
  loadHouseholdWithRelations,
  type HouseholdsDetailPrisma,
} from "./household-detail.server";

type FindManyArgs = { where?: Record<string, unknown> } & Record<string, unknown>;
type FindUniqueArgs = { where?: Record<string, unknown> } & Record<string, unknown>;

/**
 * Tiny in-memory stand-in for the slice of Prisma we touch. We don't try to
 * model the full client — just the find-many/-unique pair the helpers call.
 * Each table is just an array; the `where.householdId === id` and
 * `where.id === id` filters cover what these tests need.
 */
type Tables = {
  households: Array<{
    id: string;
    name: string;
    pickupNotes: string | null;
    primaryContactName: string | null;
    primaryContactPhone: string | null;
    spaceNumber: number | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  students: Array<{
    id: number;
    firstName: string;
    lastName: string;
    householdId: string | null;
    homeRoom: string | null;
  }>;
  exceptions: Array<{
    id: string;
    householdId: string | null;
    studentId: number | null;
    scheduleKind: string;
    exceptionDate: Date | null;
    dayOfWeek: number | null;
    startsOn: Date | null;
    endsOn: Date | null;
    dismissalPlan: string;
    pickupContactName: string | null;
    notes: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
  callEvents: Array<{
    id: number;
    studentId: number | null;
    studentName: string;
    homeRoomSnapshot: string | null;
    spaceNumber: number;
    createdAt: Date;
  }>;
  users: Array<{
    id: string;
    orgId: string | null;
    name: string;
    email: string;
    role: string;
  }>;
};

function buildPrisma(tables: Tables): HouseholdsDetailPrisma {
  return {
    household: {
      findUnique: async (args: FindUniqueArgs) => {
        const id = (args.where as { id?: string } | undefined)?.id;
        return tables.households.find((h) => h.id === id) ?? null;
      },
    },
    student: {
      findMany: async (args: FindManyArgs) => {
        const where = (args.where ?? {}) as { householdId?: string };
        const rows = tables.students.filter(
          (s) => !where.householdId || s.householdId === where.householdId,
        );
        return rows.sort((a, b) => {
          const last = a.lastName.localeCompare(b.lastName);
          return last !== 0 ? last : a.firstName.localeCompare(b.firstName);
        });
      },
    },
    dismissalException: {
      findMany: async (args: FindManyArgs) => {
        const where = (args.where ?? {}) as {
          householdId?: string;
          isActive?: boolean;
        };
        return tables.exceptions.filter(
          (e) =>
            (where.householdId === undefined ||
              e.householdId === where.householdId) &&
            (where.isActive === undefined || e.isActive === where.isActive),
        );
      },
    },
    callEvent: {
      findMany: async (args: FindManyArgs) => {
        const where = (args.where ?? {}) as {
          studentId?: { in?: number[] };
        };
        const ids = where.studentId?.in ?? [];
        const matched = tables.callEvents
          .filter((e) => e.studentId !== null && ids.includes(e.studentId))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const take = (args.take as number | undefined) ?? matched.length;
        return matched.slice(0, take);
      },
    },
    user: {
      findMany: async (args: FindManyArgs) => {
        const where = (args.where ?? {}) as {
          orgId?: string;
          name?: string;
        };
        const rows = tables.users.filter(
          (u) =>
            (where.orgId === undefined || u.orgId === where.orgId) &&
            (where.name === undefined || u.name === where.name),
        );
        const take = (args.take as number | undefined) ?? rows.length;
        return rows.slice(0, take);
      },
    },
  } as unknown as HouseholdsDetailPrisma;
}

const baseTables = (): Tables => ({
  households: [
    {
      id: "hh_1",
      name: "Garcia household",
      pickupNotes: "siblings ride together",
      primaryContactName: "Maria Garcia",
      primaryContactPhone: "555-0100",
      spaceNumber: 12,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    },
    {
      id: "hh_2",
      name: "Lee household",
      pickupNotes: null,
      primaryContactName: null,
      primaryContactPhone: null,
      spaceNumber: 4,
      createdAt: new Date("2026-02-01T00:00:00Z"),
      updatedAt: new Date("2026-02-02T00:00:00Z"),
    },
  ],
  students: [
    {
      id: 1,
      firstName: "Ana",
      lastName: "Garcia",
      householdId: "hh_1",
      homeRoom: "K-1",
    },
    {
      id: 2,
      firstName: "Luis",
      lastName: "Garcia",
      householdId: "hh_1",
      homeRoom: "2-3",
    },
    {
      id: 3,
      firstName: "Mei",
      lastName: "Lee",
      householdId: "hh_2",
      homeRoom: "1-1",
    },
  ],
  exceptions: [
    {
      id: "ex_1",
      householdId: "hh_1",
      studentId: null,
      scheduleKind: "WEEKLY",
      exceptionDate: null,
      dayOfWeek: 3,
      startsOn: null,
      endsOn: null,
      dismissalPlan: "Walker",
      pickupContactName: "Grandma",
      notes: "Wednesdays",
      isActive: true,
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    },
    {
      id: "ex_archived",
      householdId: "hh_1",
      studentId: null,
      scheduleKind: "DATE",
      exceptionDate: new Date("2025-12-31T00:00:00Z"),
      dayOfWeek: null,
      startsOn: null,
      endsOn: null,
      dismissalPlan: "Bus",
      pickupContactName: null,
      notes: null,
      isActive: false,
      createdAt: new Date("2025-12-30T00:00:00Z"),
      updatedAt: new Date("2025-12-30T00:00:00Z"),
    },
  ],
  callEvents: [
    {
      id: 1,
      studentId: 1,
      studentName: "Ana Garcia",
      homeRoomSnapshot: "K-1",
      spaceNumber: 12,
      createdAt: new Date("2026-04-01T15:00:00Z"),
    },
    {
      id: 2,
      studentId: 2,
      studentName: "Luis Garcia",
      homeRoomSnapshot: "2-3",
      spaceNumber: 9,
      createdAt: new Date("2026-04-02T15:05:00Z"),
    },
    {
      id: 3,
      studentId: 3,
      studentName: "Mei Lee",
      homeRoomSnapshot: "1-1",
      spaceNumber: 4,
      createdAt: new Date("2026-04-03T15:10:00Z"),
    },
  ],
  users: [
    {
      id: "u_admin_garcia",
      orgId: "org_school",
      name: "Maria Garcia",
      email: "maria@example.com",
      role: "ADMIN",
    },
    {
      id: "u_other_org",
      orgId: "org_other",
      name: "Maria Garcia",
      email: "twin@example.com",
      role: "VIEWER",
    },
  ],
});

test("loadHouseholdWithRelations stitches students, active exceptions, and recent calls", async () => {
  const prisma = buildPrisma(baseTables());
  const result = await loadHouseholdWithRelations(prisma, "hh_1");
  assert.ok(result, "expected a household record");
  assert.equal(result.id, "hh_1");
  assert.equal(result.name, "Garcia household");
  assert.equal(result.students.length, 2);
  assert.deepEqual(
    result.students.map((s) => s.id),
    [1, 2],
  );
  // Only the active exception is surfaced — archived rows are filtered.
  assert.equal(result.exceptions.length, 1);
  assert.equal(result.exceptions[0].id, "ex_1");
  // Call events are scoped to this household's students only.
  assert.deepEqual(
    result.recentCallEvents.map((e) => e.studentId).sort(),
    [1, 2],
  );
});

test("loadHouseholdWithRelations returns null for unknown household", async () => {
  const prisma = buildPrisma(baseTables());
  const result = await loadHouseholdWithRelations(prisma, "hh_does_not_exist");
  assert.equal(result, null);
});

test("loadHouseholdWithRelations skips call-event lookup when no students are assigned", async () => {
  const tables = baseTables();
  // Simulate a household with no assigned students.
  tables.students = tables.students.filter((s) => s.householdId !== "hh_2");
  let callEventCalls = 0;
  const base = buildPrisma(tables) as unknown as {
    callEvent: { findMany: (a: unknown) => Promise<unknown[]> };
  } & HouseholdsDetailPrisma;
  const wrapped: HouseholdsDetailPrisma = {
    ...base,
    callEvent: {
      findMany: async (args: unknown) => {
        callEventCalls++;
        return base.callEvent.findMany(args);
      },
    },
  } as HouseholdsDetailPrisma;
  const result = await loadHouseholdWithRelations(wrapped, "hh_2");
  assert.ok(result);
  assert.equal(result.recentCallEvents.length, 0);
  assert.equal(callEventCalls, 0, "no students → don't query call events");
});

test("findLinkedAdminUser returns the unique in-org match", async () => {
  const prisma = buildPrisma(baseTables());
  const linked = await findLinkedAdminUser(prisma, {
    orgId: "org_school",
    contactName: "Maria Garcia",
  });
  assert.ok(linked);
  assert.equal(linked.id, "u_admin_garcia");
  assert.equal(linked.email, "maria@example.com");
});

test("findLinkedAdminUser returns null when contact name is empty/whitespace", async () => {
  const prisma = buildPrisma(baseTables());
  assert.equal(
    await findLinkedAdminUser(prisma, { orgId: "org_school", contactName: "" }),
    null,
  );
  assert.equal(
    await findLinkedAdminUser(prisma, {
      orgId: "org_school",
      contactName: "   ",
    }),
    null,
  );
  assert.equal(
    await findLinkedAdminUser(prisma, {
      orgId: "org_school",
      contactName: null,
    }),
    null,
  );
});

test("findLinkedAdminUser ignores users in a different org", async () => {
  const prisma = buildPrisma(baseTables());
  const linked = await findLinkedAdminUser(prisma, {
    orgId: "org_school_does_not_exist",
    contactName: "Maria Garcia",
  });
  assert.equal(linked, null);
});

test("findLinkedAdminUser collapses to null on ambiguous matches", async () => {
  const tables = baseTables();
  // Add a duplicate name within the same org — the helper should refuse to
  // guess.
  tables.users.push({
    id: "u_admin_garcia_2",
    orgId: "org_school",
    name: "Maria Garcia",
    email: "maria2@example.com",
    role: "ADMIN",
  });
  const prisma = buildPrisma(tables);
  const linked = await findLinkedAdminUser(prisma, {
    orgId: "org_school",
    contactName: "Maria Garcia",
  });
  assert.equal(linked, null);
});
