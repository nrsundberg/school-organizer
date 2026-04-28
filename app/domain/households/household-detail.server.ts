/**
 * Server-side helpers for the Households admin detail page.
 *
 * Two responsibilities:
 *
 *  1. `loadHouseholdWithRelations` — pulls a household and all of its
 *     dependent records (students, exceptions, and the call-event tail
 *     filtered to the household's students) in a single helper so the
 *     route loader stays readable. The detail page shows ~5 sections that
 *     all riff on the same household, so co-locating the fetch makes the
 *     query plan easier to reason about.
 *
 *  2. `findLinkedAdminUser` — looks for a `User` row whose email matches
 *     the household's `primaryContactName`/-Phone-adjacent contact. The
 *     household record itself only stores a primary-contact name + phone
 *     (no email), so we treat the contact name as a search hint and fall
 *     back to looking for *any* in-org user whose email matches a hint
 *     the caller supplies (typically a prospective contact email entered
 *     elsewhere in the UI). Today the only signal we have is the contact
 *     name, so the lookup matches Users with the same `name` within the
 *     household's org. Designed so the rule can be tightened (e.g. to
 *     match contact emails) without changing call sites.
 */

import type { PrismaClient } from "~/db";

export type HouseholdsDetailPrisma = Pick<
  PrismaClient,
  "household" | "student" | "dismissalException" | "callEvent" | "user"
>;

export type HouseholdDetailRecord = {
  id: string;
  name: string;
  pickupNotes: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
  students: Array<{
    id: number;
    firstName: string;
    lastName: string;
    homeRoom: string | null;
    spaceNumber: number | null;
  }>;
  exceptions: Array<{
    id: string;
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
  recentCallEvents: Array<{
    id: number;
    studentId: number | null;
    studentName: string;
    homeRoomSnapshot: string | null;
    spaceNumber: number;
    createdAt: Date;
  }>;
};

export async function loadHouseholdWithRelations(
  prisma: HouseholdsDetailPrisma,
  householdId: string,
): Promise<HouseholdDetailRecord | null> {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: {
      id: true,
      name: true,
      pickupNotes: true,
      primaryContactName: true,
      primaryContactPhone: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!household) return null;

  const [students, exceptions] = await Promise.all([
    prisma.student.findMany({
      where: { householdId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        homeRoom: true,
        spaceNumber: true,
      },
    }),
    prisma.dismissalException.findMany({
      where: { householdId, isActive: true },
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
  ]);

  const studentIds = students.map((s) => s.id);
  const recentCallEvents =
    studentIds.length === 0
      ? []
      : await prisma.callEvent.findMany({
          where: { studentId: { in: studentIds } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            studentId: true,
            studentName: true,
            homeRoomSnapshot: true,
            spaceNumber: true,
            createdAt: true,
          },
        });

  return {
    ...household,
    students,
    exceptions,
    recentCallEvents,
  };
}

export type LinkedAdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/**
 * Best-effort lookup for an admin/staff user attached to this household.
 * Today the household only stores a contact *name*, so we match Users on
 * `name` within the same org. Returns null if either input is empty or no
 * unambiguous match is found. The "ambiguous" case (>1 match) collapses
 * to null on purpose — the UI surfaces a "no linked user" affordance and
 * we'd rather show that than guess wrong.
 */
export async function findLinkedAdminUser(
  prisma: HouseholdsDetailPrisma,
  args: { orgId: string; contactName: string | null | undefined },
): Promise<LinkedAdminUser | null> {
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
