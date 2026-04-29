import type { PrismaClient } from "~/db";
import { toDateInputValue } from "~/domain/dismissal/schedule";

export type HouseholdsDetailPrisma = Pick<
  PrismaClient,
  "household" | "student" | "dismissalException" | "callEvent" | "user"
>;

export type StudentRow = {
  id: number;
  firstName: string;
  lastName: string;
  homeRoom: string | null;
  hasExceptionToday: boolean;
};

export type ExceptionRow = {
  id: string;
  studentId: number | null;
  scheduleKind: string;
  exceptionDate: string;
  dayOfWeek: number | null;
  startsOn: string;
  endsOn: string;
  dismissalPlan: string;
  pickupContactName: string | null;
  notes: string | null;
  isActive: boolean;
  activeToday: boolean;
  createdAtIso: string;
  updatedAtIso: string;
};

export type CallEventRow = {
  id: number;
  studentId: number | null;
  studentName: string;
  homeRoomSnapshot: string | null;
  spaceNumber: number;
  createdAtIso: string;
};

export type LinkedAdminBlock = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type HouseholdDetailView = {
  summary: {
    id: string;
    name: string;
    pickupNotes: string | null;
    primaryContactName: string | null;
    primaryContactPhone: string | null;
    spaceNumber: number | null;
    studentCount: number;
    contactCount: number;
    hasMissingContact: boolean;
    activeTodayCount: number;
    createdAtIso: string;
    updatedAtIso: string;
  };
  sections: {
    students: StudentRow[];
    exceptions: ExceptionRow[];
    recentCalls: CallEventRow[];
    linkedAdmin: LinkedAdminBlock | null;
  };
};

export type LoadHouseholdForAdminDetailOptions = {
  /** Reference instant for the activeToday computation. Defaults to `new Date()`. */
  now?: Date;
  /** Cap on `sections.recentCalls`. Defaults to 5. */
  recentCallsLimit?: number;
};

const DEFAULT_RECENT_CALLS_LIMIT = 5;

export async function loadHouseholdForAdminDetail(
  prisma: HouseholdsDetailPrisma,
  args: { householdId: string; orgId: string },
  options?: LoadHouseholdForAdminDetailOptions,
): Promise<HouseholdDetailView | null> {
  const now = options?.now ?? new Date();
  const recentCallsLimit =
    options?.recentCallsLimit ?? DEFAULT_RECENT_CALLS_LIMIT;

  const household = await prisma.household.findUnique({
    where: { id: args.householdId },
    select: {
      id: true,
      name: true,
      pickupNotes: true,
      primaryContactName: true,
      primaryContactPhone: true,
      spaceNumber: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!household) return null;

  const [students, rawExceptions, linkedAdmin] = await Promise.all([
    prisma.student.findMany({
      where: { householdId: args.householdId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        homeRoom: true,
      },
    }),
    prisma.dismissalException.findMany({
      where: { householdId: args.householdId, isActive: true },
      orderBy: [
        { scheduleKind: "asc" },
        { exceptionDate: "asc" },
        { createdAt: "desc" },
      ],
      select: {
        id: true,
        studentId: true,
        scheduleKind: true,
        exceptionDate: true,
        dayOfWeek: true,
        startsOn: true,
        endsOn: true,
        dismissalPlan: true,
        pickupContactName: true,
        notes: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    findLinkedAdmin(prisma, {
      orgId: args.orgId,
      contactName: household.primaryContactName,
    }),
  ]);

  const studentIds = students.map((s) => s.id);
  const recentCallsRaw =
    studentIds.length === 0
      ? []
      : await prisma.callEvent.findMany({
          where: { studentId: { in: studentIds } },
          orderBy: { createdAt: "desc" },
          take: recentCallsLimit,
          select: {
            id: true,
            studentId: true,
            studentName: true,
            homeRoomSnapshot: true,
            spaceNumber: true,
            createdAt: true,
          },
        });

  const exceptions: ExceptionRow[] = rawExceptions.map((e) => ({
    id: e.id,
    studentId: e.studentId,
    scheduleKind: e.scheduleKind,
    exceptionDate: toDateInputValue(e.exceptionDate),
    dayOfWeek: e.dayOfWeek,
    startsOn: toDateInputValue(e.startsOn),
    endsOn: toDateInputValue(e.endsOn),
    dismissalPlan: e.dismissalPlan,
    pickupContactName: e.pickupContactName,
    notes: e.notes,
    isActive: e.isActive,
    activeToday: exceptionActiveOn(e, now),
    createdAtIso: e.createdAt.toISOString(),
    updatedAtIso: e.updatedAt.toISOString(),
  }));

  // A student "has an exception today" if any active-today exception either
  // targets this student specifically OR is house-wide (studentId == null).
  const houseWideToday = exceptions.some(
    (e) => e.activeToday && e.studentId == null,
  );
  const targetedTodayIds = new Set(
    exceptions
      .filter((e) => e.activeToday && e.studentId != null)
      .map((e) => e.studentId as number),
  );

  const studentRows: StudentRow[] = students.map((s) => ({
    id: s.id,
    firstName: s.firstName,
    lastName: s.lastName,
    homeRoom: s.homeRoom,
    hasExceptionToday: houseWideToday || targetedTodayIds.has(s.id),
  }));

  const recentCalls: CallEventRow[] = recentCallsRaw.map((c) => ({
    id: c.id,
    studentId: c.studentId,
    studentName: c.studentName,
    homeRoomSnapshot: c.homeRoomSnapshot,
    spaceNumber: c.spaceNumber,
    createdAtIso: c.createdAt.toISOString(),
  }));

  const contactCount =
    (household.primaryContactName?.trim() ? 1 : 0) +
    (household.primaryContactPhone?.trim() ? 1 : 0);

  return {
    summary: {
      id: household.id,
      name: household.name,
      pickupNotes: household.pickupNotes,
      primaryContactName: household.primaryContactName,
      primaryContactPhone: household.primaryContactPhone,
      spaceNumber: household.spaceNumber,
      studentCount: students.length,
      contactCount,
      hasMissingContact: contactCount < 2,
      activeTodayCount: exceptions.filter((e) => e.activeToday).length,
      createdAtIso: household.createdAt.toISOString(),
      updatedAtIso: household.updatedAt.toISOString(),
    },
    sections: {
      students: studentRows,
      exceptions,
      recentCalls,
      linkedAdmin,
    },
  };
}

async function findLinkedAdmin(
  prisma: HouseholdsDetailPrisma,
  args: { orgId: string; contactName: string | null | undefined },
): Promise<LinkedAdminBlock | null> {
  const name = (args.contactName ?? "").trim();
  if (!name) return null;
  const matches = await prisma.user.findMany({
    where: { orgId: args.orgId, name },
    select: { id: true, name: true, email: true, role: true },
    take: 2,
  });
  if (matches.length !== 1) return null;
  return matches[0];
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function exceptionActiveOn(
  exception: {
    scheduleKind: string;
    exceptionDate: Date | null;
    dayOfWeek: number | null;
    startsOn: Date | null;
    endsOn: Date | null;
  },
  today: Date,
): boolean {
  const dayStart = startOfUtcDay(today);
  if (exception.scheduleKind === "DATE") {
    if (!exception.exceptionDate) return false;
    return startOfUtcDay(exception.exceptionDate).getTime() === dayStart.getTime();
  }
  if (exception.dayOfWeek == null) return false;
  if (today.getUTCDay() !== exception.dayOfWeek) return false;
  if (
    exception.startsOn &&
    dayStart.getTime() < startOfUtcDay(exception.startsOn).getTime()
  ) {
    return false;
  }
  if (
    exception.endsOn &&
    dayStart.getTime() > startOfUtcDay(exception.endsOn).getTime()
  ) {
    return false;
  }
  return true;
}
