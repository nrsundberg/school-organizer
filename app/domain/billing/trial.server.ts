import type { Org } from "~/db";
import type { PrismaClient } from "~/db/generated/client";
import {
  TRIAL_CALENDAR_DAYS,
  TRIAL_MIN_STUDENTS_PER_QUALIFYING_DAY,
  TRIAL_QUALIFYING_DAYS,
} from "~/lib/trial-rules";

export { TRIAL_CALENDAR_DAYS, TRIAL_MIN_STUDENTS_PER_QUALIFYING_DAY, TRIAL_QUALIFYING_DAYS };

export function addDaysUtc(start: Date, days: number): Date {
  const d = new Date(start.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function endOfUtcDayFromKey(isoDate: string): Date {
  const [y, m, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, 23, 59, 59, 999));
}

/**
 * Lists UTC calendar dates (yyyy-mm-dd) since `trialStartedAt` where more than
 * `TRIAL_MIN_STUDENTS_PER_QUALIFYING_DAY` distinct students appear in CallEvents with a studentId.
 */
export async function listQualifyingPickupDates(
  db: PrismaClient,
  orgId: string,
  trialStartedAt: Date,
): Promise<string[]> {
  const events = await db.callEvent.findMany({
    where: {
      orgId,
      studentId: { not: null },
      createdAt: { gte: trialStartedAt },
    },
    select: { studentId: true, createdAt: true },
  });

  const byDay = new Map<string, Set<number>>();
  for (const e of events) {
    if (e.studentId == null) continue;
    const key = utcDateKey(new Date(e.createdAt));
    let set = byDay.get(key);
    if (!set) {
      set = new Set();
      byDay.set(key, set);
    }
    set.add(e.studentId);
  }

  const qualifying: string[] = [];
  for (const [day, students] of byDay) {
    if (students.size > TRIAL_MIN_STUDENTS_PER_QUALIFYING_DAY) {
      qualifying.push(day);
    }
  }
  qualifying.sort();
  return qualifying;
}

/**
 * Trial ends at the later of: end of calendar day (start + 30 days), or end of the calendar day
 * when the 25th qualifying pickup day occurs.
 */
export function computeTrialEndsAtUtc(trialStartedAt: Date, qualifyingDatesSorted: string[]): Date {
  const d30 = addDaysUtc(trialStartedAt, TRIAL_CALENDAR_DAYS);
  if (qualifyingDatesSorted.length < TRIAL_QUALIFYING_DAYS) {
    return d30;
  }
  const t25 = endOfUtcDayFromKey(qualifyingDatesSorted[TRIAL_QUALIFYING_DAYS - 1]);
  return new Date(Math.max(d30.getTime(), t25.getTime()));
}

/**
 * Trial remains active until the later of the 30-day milestone and the 25th qualifying day.
 * If fewer than 25 qualifying days have occurred, the trial can extend past 30 calendar days until
 * enough qualifying days exist (product rule: whichever milestone finishes later).
 */
export function trialStillActive(
  org: Pick<Org, "status" | "trialStartedAt">,
  qualifyingDatesSorted: string[],
  now: Date,
): boolean {
  if (org.status !== "TRIALING" || !org.trialStartedAt) {
    return false;
  }
  if (qualifyingDatesSorted.length < TRIAL_QUALIFYING_DAYS) {
    return true;
  }
  const end = computeTrialEndsAtUtc(org.trialStartedAt, qualifyingDatesSorted);
  return now.getTime() < end.getTime();
}
