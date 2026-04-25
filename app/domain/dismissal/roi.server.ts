import {
  countWeekdayOccurrences,
  endOfUtcDay,
  rangesOverlap,
  toDateInputValue,
  type DateRange,
} from "~/domain/dismissal/schedule";

export const ROI_ASSUMPTIONS = {
  minutesPerAvoidedCall: 3,
  callsAvoidedPerExceptionOccurrence: 1,
  callsAvoidedPerProgramCancellation: 6,
} as const;

type CallEventForRoi = {
  id: number;
  createdAt: Date | string;
};

type StudentForRoi = {
  id: number;
  householdId: string | null;
};

type ExceptionForRoi = {
  id: string;
  scheduleKind: string;
  exceptionDate: Date | string | null;
  dayOfWeek: number | null;
  startsOn: Date | string | null;
  endsOn: Date | string | null;
  isActive: boolean;
};

type CancellationForRoi = {
  id: string;
  cancellationDate: Date | string;
};

type RoiPrisma = {
  callEvent: {
    findMany(args: unknown): Promise<CallEventForRoi[]>;
  };
  student: {
    findMany(args: unknown): Promise<StudentForRoi[]>;
  };
  dismissalException: {
    findMany(args: unknown): Promise<ExceptionForRoi[]>;
  };
  programCancellation: {
    findMany(args: unknown): Promise<CancellationForRoi[]>;
  };
};

export type RoiDashboardSnapshot = {
  range: {
    from: string;
    to: string;
  };
  baselineCalls: number;
  pickupDaysWithCalls: number;
  householdGroups: number;
  householdSiblingSlots: number;
  exceptionOccurrences: number;
  programCancellations: number;
  avoidedCalls: {
    households: number;
    exceptions: number;
    cancellations: number;
    total: number;
  };
  minutesSaved: number;
  assumptions: typeof ROI_ASSUMPTIONS;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function dayKey(value: Date | string): string {
  return toDateInputValue(asDate(value));
}

export function estimateHouseholdAvoidedCalls(
  students: StudentForRoi[],
  pickupDaysWithCalls: number,
): { householdGroups: number; siblingSlots: number; avoidedCalls: number } {
  const groups = new Map<string, number>();
  for (const student of students) {
    if (!student.householdId) continue;
    groups.set(student.householdId, (groups.get(student.householdId) ?? 0) + 1);
  }

  let householdGroups = 0;
  let siblingSlots = 0;
  for (const count of groups.values()) {
    if (count < 2) continue;
    householdGroups += 1;
    siblingSlots += count - 1;
  }

  return {
    householdGroups,
    siblingSlots,
    avoidedCalls: siblingSlots * pickupDaysWithCalls,
  };
}

export function countExceptionOccurrencesInRange(
  exceptions: ExceptionForRoi[],
  range: DateRange,
): number {
  let count = 0;
  for (const exception of exceptions) {
    if (!exception.isActive) continue;

    if (exception.scheduleKind === "DATE") {
      if (!exception.exceptionDate) continue;
      const date = asDate(exception.exceptionDate);
      if (date.getTime() >= range.from.getTime() && date.getTime() <= range.to.getTime()) {
        count += 1;
      }
      continue;
    }

    if (exception.scheduleKind === "WEEKLY" && exception.dayOfWeek != null) {
      const startsOn = exception.startsOn ? asDate(exception.startsOn) : range.from;
      const endsOn = exception.endsOn ? endOfUtcDay(asDate(exception.endsOn)) : range.to;
      const overlap = {
        from: new Date(Math.max(range.from.getTime(), startsOn.getTime())),
        to: new Date(Math.min(range.to.getTime(), endsOn.getTime())),
      };
      if (rangesOverlap(range, { from: startsOn, to: endsOn })) {
        count += countWeekdayOccurrences(exception.dayOfWeek, overlap);
      }
    }
  }
  return count;
}

export async function buildRoiDashboardSnapshot(
  prisma: RoiPrisma,
  range: DateRange,
): Promise<RoiDashboardSnapshot> {
  const [callEvents, students, exceptions, cancellations] = await Promise.all([
    prisma.callEvent.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      select: { id: true, createdAt: true },
    }),
    prisma.student.findMany({
      select: { id: true, householdId: true },
    }),
    prisma.dismissalException.findMany({
      where: { isActive: true },
      select: {
        id: true,
        scheduleKind: true,
        exceptionDate: true,
        dayOfWeek: true,
        startsOn: true,
        endsOn: true,
        isActive: true,
      },
    }),
    prisma.programCancellation.findMany({
      where: { cancellationDate: { gte: range.from, lte: range.to } },
      select: { id: true, cancellationDate: true },
    }),
  ]);

  const callDays = new Set(callEvents.map((event) => dayKey(event.createdAt)));
  const householdEstimate = estimateHouseholdAvoidedCalls(students, callDays.size);
  const exceptionOccurrences = countExceptionOccurrencesInRange(exceptions, range);
  const exceptionAvoidedCalls =
    exceptionOccurrences * ROI_ASSUMPTIONS.callsAvoidedPerExceptionOccurrence;
  const cancellationAvoidedCalls =
    cancellations.length * ROI_ASSUMPTIONS.callsAvoidedPerProgramCancellation;
  const totalAvoidedCalls =
    householdEstimate.avoidedCalls + exceptionAvoidedCalls + cancellationAvoidedCalls;

  return {
    range: {
      from: toDateInputValue(range.from),
      to: toDateInputValue(range.to),
    },
    baselineCalls: callEvents.length,
    pickupDaysWithCalls: callDays.size,
    householdGroups: householdEstimate.householdGroups,
    householdSiblingSlots: householdEstimate.siblingSlots,
    exceptionOccurrences,
    programCancellations: cancellations.length,
    avoidedCalls: {
      households: householdEstimate.avoidedCalls,
      exceptions: exceptionAvoidedCalls,
      cancellations: cancellationAvoidedCalls,
      total: totalAvoidedCalls,
    },
    minutesSaved: totalAvoidedCalls * ROI_ASSUMPTIONS.minutesPerAvoidedCall,
    assumptions: ROI_ASSUMPTIONS,
  };
}
