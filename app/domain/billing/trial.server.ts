import type { Org } from "~/db";
import type { PrismaClient } from "~/db/generated/client";
import {
  TRIAL_CALENDAR_DAYS,
  TRIAL_MIN_STUDENTS_PER_QUALIFYING_DAY,
  TRIAL_QUALIFYING_DAYS,
} from "~/lib/trial-rules";

export { TRIAL_CALENDAR_DAYS, TRIAL_MIN_STUDENTS_PER_QUALIFYING_DAY, TRIAL_QUALIFYING_DAYS };

// ---------------------------------------------------------------------------
// Pure trial evaluation — no DB calls.
// ---------------------------------------------------------------------------

export type TrialStatus = {
  isActive: boolean;
  daysElapsed: number;
  pickupDaysUsed: number;
  reason: "active" | "expired" | "not_on_trial" | "comped";
};

/**
 * Evaluate trial state for an org without touching the database.
 *
 * Rules:
 * - Non-FREE plans → reason: "not_on_trial"
 * - No trialStartedAt → reason: "not_on_trial"  (trial has not begun)
 * - compedUntil > now → reason: "comped"  (active regardless of thresholds)
 * - FREE plan, trial started:
 *   - active if daysElapsed < 30 OR pickupDaysUsed < 25 (whichever ends later)
 *   - expired only when BOTH thresholds are met
 */
export function evaluateTrial(params: {
  billingPlan: "FREE" | "CAR_LINE" | "CAMPUS" | "ENTERPRISE";
  trialStartedAt: Date | null;
  now: Date;
  pickupDaysUsed: number;
  compedUntil: Date | null;
}): TrialStatus {
  const { billingPlan, trialStartedAt, now, pickupDaysUsed, compedUntil } = params;

  if (billingPlan !== "FREE") {
    return { isActive: true, daysElapsed: 0, pickupDaysUsed, reason: "not_on_trial" };
  }

  if (!trialStartedAt) {
    return { isActive: true, daysElapsed: 0, pickupDaysUsed, reason: "not_on_trial" };
  }

  // Comped bypass
  if (compedUntil && compedUntil.getTime() > now.getTime()) {
    const daysElapsed = Math.floor((now.getTime() - trialStartedAt.getTime()) / 86_400_000);
    return { isActive: true, daysElapsed, pickupDaysUsed, reason: "comped" };
  }

  const daysElapsed = Math.floor((now.getTime() - trialStartedAt.getTime()) / 86_400_000);

  // Active if EITHER threshold is not yet met
  const calendarOk = daysElapsed < TRIAL_CALENDAR_DAYS;
  const pickupOk = pickupDaysUsed < TRIAL_QUALIFYING_DAYS;

  if (calendarOk || pickupOk) {
    return { isActive: true, daysElapsed, pickupDaysUsed, reason: "active" };
  }

  return { isActive: false, daysElapsed, pickupDaysUsed, reason: "expired" };
}

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
