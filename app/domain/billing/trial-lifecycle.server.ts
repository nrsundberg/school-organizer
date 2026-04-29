import type { Org } from "~/db";
import type { PrismaClient } from "~/db/generated/client";
import {
  TRIAL_CALENDAR_DAYS,
  TRIAL_MIN_STUDENTS_PER_QUALIFYING_DAY,
  TRIAL_QUALIFYING_DAYS,
  addDaysUtc,
} from "~/domain/billing/trial.server";

/**
 * The trial state machine.
 *
 * `evaluateTrialStatus` is a pure projection: read the org row + call-event
 * history, return one of three recommendations (`not_applicable` / `active`
 * / `should_end`). It does not mutate.
 *
 * `applyTrialEvaluation` is the only writer: given a recommendation it
 * persists the updated denormalized fields (`trialQualifyingPickupDays`,
 * `trialEndsAt`) and, on `should_end`, flips the org status to INCOMPLETE.
 *
 * Splitting compute from apply keeps the evaluator callable from non-cron
 * paths (e.g. an admin "preview trial state" view) without write side
 * effects, while the cron path chains `evaluate → apply`.
 */

export type TrialLifecycleOrg = Pick<
  Org,
  | "id"
  | "status"
  | "billingPlan"
  | "trialStartedAt"
  | "trialEndsAt"
  | "trialQualifyingPickupDays"
  | "compedUntil"
  | "isComped"
>;

export type TrialLifecyclePrisma = Pick<PrismaClient, "callEvent" | "org">;

export type TrialEvaluation =
  | {
      kind: "not_applicable";
      reason: "paid_plan" | "not_started" | "comped" | "not_trialing";
    }
  | {
      kind: "active";
      endsAt: Date;
      daysRemaining: number;
      pickupDaysRemaining: number;
      pickupDaysUsed: number;
    }
  | {
      kind: "should_end";
      endsAt: Date;
      reason: "BOTH_THRESHOLDS_MET";
      pickupDaysUsed: number;
    };

export async function evaluateTrialStatus(
  org: TrialLifecycleOrg,
  prisma: TrialLifecyclePrisma,
  now: Date,
): Promise<TrialEvaluation> {
  if (org.billingPlan !== "FREE") {
    return { kind: "not_applicable", reason: "paid_plan" };
  }
  if (!org.trialStartedAt) {
    return { kind: "not_applicable", reason: "not_started" };
  }
  if (
    org.isComped ||
    (org.compedUntil && org.compedUntil.getTime() > now.getTime())
  ) {
    return { kind: "not_applicable", reason: "comped" };
  }
  if (org.status !== "TRIALING") {
    return { kind: "not_applicable", reason: "not_trialing" };
  }

  const qualifyingDates = await listQualifyingPickupDates(
    prisma,
    org.id,
    org.trialStartedAt,
  );
  const pickupDaysUsed = qualifyingDates.length;
  const endsAt = computeTrialEndsAtUtc(org.trialStartedAt, qualifyingDates);

  const calendarOk = now.getTime() < endsAt.getTime();
  const pickupOk = pickupDaysUsed < TRIAL_QUALIFYING_DAYS;

  if (calendarOk || pickupOk) {
    const daysRemaining = Math.max(
      0,
      Math.floor((endsAt.getTime() - now.getTime()) / 86_400_000),
    );
    const pickupDaysRemaining = Math.max(
      0,
      TRIAL_QUALIFYING_DAYS - pickupDaysUsed,
    );
    return {
      kind: "active",
      endsAt,
      daysRemaining,
      pickupDaysRemaining,
      pickupDaysUsed,
    };
  }

  return {
    kind: "should_end",
    endsAt,
    reason: "BOTH_THRESHOLDS_MET",
    pickupDaysUsed,
  };
}

export async function applyTrialEvaluation(
  prisma: TrialLifecyclePrisma,
  orgId: string,
  evaluation: TrialEvaluation,
): Promise<{ changed: boolean }> {
  if (evaluation.kind === "not_applicable") {
    return { changed: false };
  }

  if (evaluation.kind === "active") {
    await prisma.org.update({
      where: { id: orgId },
      data: {
        trialQualifyingPickupDays: evaluation.pickupDaysUsed,
        trialEndsAt: evaluation.endsAt,
      },
    });
    return { changed: true };
  }

  // should_end
  await prisma.org.update({
    where: { id: orgId },
    data: {
      status: "INCOMPLETE",
      trialQualifyingPickupDays: evaluation.pickupDaysUsed,
      trialEndsAt: evaluation.endsAt,
    },
  });
  return { changed: true };
}

// ---------------------------------------------------------------------------
// Private trial-math helpers — moved from trial.server.ts where they were
// public-but-only-used-here. Keeping them encapsulated here means future
// rule changes (holiday pause, weekday-only counting, etc.) live behind
// the lifecycle seam instead of fanning out across callers.
// ---------------------------------------------------------------------------

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function endOfUtcDayFromKey(isoDate: string): Date {
  const [y, m, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, 23, 59, 59, 999));
}

async function listQualifyingPickupDates(
  prisma: TrialLifecyclePrisma,
  orgId: string,
  trialStartedAt: Date,
): Promise<string[]> {
  const events = await prisma.callEvent.findMany({
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

function computeTrialEndsAtUtc(
  trialStartedAt: Date,
  qualifyingDatesSorted: string[],
): Date {
  const d30 = addDaysUtc(trialStartedAt, TRIAL_CALENDAR_DAYS);
  if (qualifyingDatesSorted.length < TRIAL_QUALIFYING_DAYS) {
    return d30;
  }
  const t25 = endOfUtcDayFromKey(
    qualifyingDatesSorted[TRIAL_QUALIFYING_DAYS - 1],
  );
  return new Date(Math.max(d30.getTime(), t25.getTime()));
}
