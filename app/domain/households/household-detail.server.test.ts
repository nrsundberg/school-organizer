import test from "node:test";
import assert from "node:assert/strict";
import {
  loadHouseholdForAdminDetail,
  type HouseholdsDetailPrisma,
} from "./household-detail.server";

type FindManyArgs = { where?: Record<string, unknown> } & Record<string, unknown>;
type FindUniqueArgs = { where?: Record<string, unknown> } & Record<string, unknown>;

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

const NOW = new Date("2026-04-29T15:00:00Z"); // Wednesday (UTC dayOfWeek = 3)

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
      // Active today via WEEKLY rule (Wed = 3), bound to Ana (studentId=1).
      id: "ex_weekly_today",
      householdId: "hh_1",
      studentId: 1,
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
      // Active later this week (Thursday) — not active today.
      id: "ex_weekly_thu",
      householdId: "hh_1",
      studentId: null,
      scheduleKind: "WEEKLY",
      exceptionDate: null,
      dayOfWeek: 4,
      startsOn: null,
      endsOn: null,
      dismissalPlan: "Bus",
      pickupContactName: null,
      notes: null,
      isActive: true,
      createdAt: new Date("2026-03-02T00:00:00Z"),
      updatedAt: new Date("2026-03-02T00:00:00Z"),
    },
    {
      // Archived — must be filtered.
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

test("returns null for unknown household", async () => {
  const prisma = buildPrisma(baseTables());
  const result = await loadHouseholdForAdminDetail(
    prisma,
    { householdId: "hh_does_not_exist", orgId: "org_school" },
    { now: NOW },
  );
  assert.equal(result, null);
});

test("summary aggregates studentCount, contactCount, activeTodayCount", async () => {
  const prisma = buildPrisma(baseTables());
  const view = await loadHouseholdForAdminDetail(
    prisma,
    { householdId: "hh_1", orgId: "org_school" },
    { now: NOW },
  );
  assert.ok(view);
  assert.equal(view.summary.id, "hh_1");
  assert.equal(view.summary.name, "Garcia household");
  assert.equal(view.summary.studentCount, 2);
  // Both name and phone present → 2.
  assert.equal(view.summary.contactCount, 2);
  assert.equal(view.summary.hasMissingContact, false);
  // Only the WEEKLY-Wednesday exception is active today.
  assert.equal(view.summary.activeTodayCount, 1);
  assert.equal(view.summary.createdAtIso, "2026-01-01T00:00:00.000Z");
  assert.equal(view.summary.updatedAtIso, "2026-01-02T00:00:00.000Z");
});

test("summary.hasMissingContact is true when name or phone is missing", async () => {
  const prisma = buildPrisma(baseTables());
  const view = await loadHouseholdForAdminDetail(
    prisma,
    { householdId: "hh_2", orgId: "org_school" },
    { now: NOW },
  );
  assert.ok(view);
  assert.equal(view.summary.contactCount, 0);
  assert.equal(view.summary.hasMissingContact, true);
});

test("students section pre-computes hasExceptionToday per student", async () => {
  const prisma = buildPrisma(baseTables());
  const view = await loadHouseholdForAdminDetail(
    prisma,
    { householdId: "hh_1", orgId: "org_school" },
    { now: NOW },
  );
  assert.ok(view);
  const ana = view.sections.students.find((s) => s.id === 1);
  const luis = view.sections.students.find((s) => s.id === 2);
  assert.ok(ana);
  assert.ok(luis);
  // Ana is the studentId on the active-today WEEKLY exception.
  assert.equal(ana.hasExceptionToday, true);
  assert.equal(luis.hasExceptionToday, false);
});

test("a house-wide active-today exception flags every student", async () => {
  const tables = baseTables();
  // Replace the targeted exception with a house-wide one (studentId: null).
  const ex = tables.exceptions.find((e) => e.id === "ex_weekly_today");
  if (ex) ex.studentId = null;
  const prisma = buildPrisma(tables);
  const view = await loadHouseholdForAdminDetail(
    prisma,
    { householdId: "hh_1", orgId: "org_school" },
    { now: NOW },
  );
  assert.ok(view);
  for (const s of view.sections.students) {
    assert.equal(s.hasExceptionToday, true, `student ${s.id} should be flagged`);
  }
});

test("exceptions section converts dates to input strings and computes activeToday", async () => {
  const prisma = buildPrisma(baseTables());
  const view = await loadHouseholdForAdminDetail(
    prisma,
    { householdId: "hh_1", orgId: "org_school" },
    { now: NOW },
  );
  assert.ok(view);
  // Archived is filtered out at the query level (isActive: true).
  const ids = view.sections.exceptions.map((e) => e.id);
  assert.deepEqual(ids.sort(), ["ex_weekly_thu", "ex_weekly_today"]);

  const today = view.sections.exceptions.find((e) => e.id === "ex_weekly_today")!;
  const thu = view.sections.exceptions.find((e) => e.id === "ex_weekly_thu")!;
  assert.equal(today.activeToday, true);
  assert.equal(thu.activeToday, false);
  // Date inputs are empty strings when null (matches toDateInputValue contract).
  assert.equal(today.exceptionDate, "");
  assert.equal(today.startsOn, "");
  assert.equal(today.endsOn, "");
  assert.equal(today.createdAtIso, "2026-03-01T00:00:00.000Z");
});

test("recentCalls section is scoped to this household's students and capped", async () => {
  const prisma = buildPrisma(baseTables());
  const view = await loadHouseholdForAdminDetail(
    prisma,
    { householdId: "hh_1", orgId: "org_school" },
    { now: NOW },
  );
  assert.ok(view);
  const studentIds = view.sections.recentCalls
    .map((c) => c.studentId)
    .sort((a, b) => Number(a) - Number(b));
  assert.deepEqual(studentIds, [1, 2]);
  for (const c of view.sections.recentCalls) {
    assert.match(c.createdAtIso, /^\d{4}-\d{2}-\d{2}T/);
  }
});

test("recentCallsLimit option overrides default cap", async () => {
  const tables = baseTables();
  // Add 7 events for student 1 so we can verify the cap.
  for (let i = 10; i < 17; i++) {
    tables.callEvents.push({
      id: i,
      studentId: 1,
      studentName: "Ana Garcia",
      homeRoomSnapshot: "K-1",
      spaceNumber: 12,
      createdAt: new Date(`2026-04-${10 + (i - 10)}T15:00:00Z`),
    });
  }
  const prisma = buildPrisma(tables);
  const view = await loadHouseholdForAdminDetail(
    prisma,
    { householdId: "hh_1", orgId: "org_school" },
    { now: NOW, recentCallsLimit: 3 },
  );
  assert.ok(view);
  assert.equal(view.sections.recentCalls.length, 3);
});

test("skips call-event lookup when household has no students", async () => {
  const tables = baseTables();
  // Detach all students from hh_2 (it already has only one — drop it).
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
  const view = await loadHouseholdForAdminDetail(
    wrapped,
    { householdId: "hh_2", orgId: "org_school" },
    { now: NOW },
  );
  assert.ok(view);
  assert.equal(view.sections.recentCalls.length, 0);
  assert.equal(callEventCalls, 0);
});

test("linkedAdmin resolves the unique in-org user matching contactName", async () => {
  const prisma = buildPrisma(baseTables());
  const view = await loadHouseholdForAdminDetail(
    prisma,
    { householdId: "hh_1", orgId: "org_school" },
    { now: NOW },
  );
  assert.ok(view);
  assert.ok(view.sections.linkedAdmin);
  assert.equal(view.sections.linkedAdmin.id, "u_admin_garcia");
  assert.equal(view.sections.linkedAdmin.email, "maria@example.com");
});

test("linkedAdmin is null when household has no primary contact name", async () => {
  const prisma = buildPrisma(baseTables());
  const view = await loadHouseholdForAdminDetail(
    prisma,
    { householdId: "hh_2", orgId: "org_school" },
    { now: NOW },
  );
  assert.ok(view);
  assert.equal(view.sections.linkedAdmin, null);
});

test("linkedAdmin collapses to null on ambiguous matches in the same org", async () => {
  const tables = baseTables();
  tables.users.push({
    id: "u_admin_garcia_2",
    orgId: "org_school",
    name: "Maria Garcia",
    email: "maria2@example.com",
    role: "ADMIN",
  });
  const prisma = buildPrisma(tables);
  const view = await loadHouseholdForAdminDetail(
    prisma,
    { householdId: "hh_1", orgId: "org_school" },
    { now: NOW },
  );
  assert.ok(view);
  assert.equal(view.sections.linkedAdmin, null);
});

test("linkedAdmin ignores users in a different org", async () => {
  const prisma = buildPrisma(baseTables());
  const view = await loadHouseholdForAdminDetail(
    prisma,
    { householdId: "hh_1", orgId: "org_school_does_not_exist" },
    { now: NOW },
  );
  assert.ok(view);
  assert.equal(view.sections.linkedAdmin, null);
});
