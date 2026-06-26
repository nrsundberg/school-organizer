import type { BillingPlan, Org } from "~/db";
import type { PrismaClient } from "~/db/generated/client";
import {
  hardCeiling,
  PLAN_LIMITS,
  type NumericPlanLimits,
  type PlanLimitTier,
  USAGE_GRACE_DAYS,
  warnThreshold,
} from "~/lib/plan-limits";
import type { UsageCounts, UsageLevel, UsageSnapshot } from "~/lib/plan-usage-types";
import { addDaysUtc } from "~/domain/billing/trial.server";

export type { UsageCounts, UsageSnapshot, UsageLevel } from "~/lib/plan-usage-types";

export function resolveLimitTier(plan: BillingPlan): PlanLimitTier {
  switch (plan) {
    case "ENTERPRISE":
      return "ENTERPRISE";
    case "CAMPUS":
    case "STARTER":
      return "CAMPUS";
    case "CAR_LINE":
      return "CAR_LINE";
    case "FREE":
    default:
      return "FREE";
  }
}

type OrgLimitOverrides = {
  limitStudents?: number | null;
  limitFamilies?: number | null;
  limitClassrooms?: number | null;
};

export function getNumericLimits(
  plan: BillingPlan,
  overrides?: OrgLimitOverrides,
): NumericPlanLimits | null {
  const tier = resolveLimitTier(plan);
  if (tier === "ENTERPRISE") return null;
  const base = PLAN_LIMITS[tier];
  return {
    students: overrides?.limitStudents ?? base.students,
    families: overrides?.limitFamilies ?? base.families,
    classrooms: overrides?.limitClassrooms ?? base.classrooms,
  };
}

/**
 * How much `families` count increases when adding one student.
 * Siblings share `householdId`; unassigned students each count as one family.
 */
export async function familiesDeltaForNewStudent(
  prisma: PrismaClient,
  orgId: string,
  householdId: string | null,
): Promise<number> {
  if (!householdId?.trim()) return 1;
  const existing = await prisma.student.count({
    where: { orgId, householdId: householdId.trim() },
  });
  return existing > 0 ? 0 : 1;
}

export async function countOrgUsage(
  prisma: PrismaClient,
  orgId: string,
): Promise<UsageCounts> {
  // `families` = households that have at least one student (siblings share a
  // `householdId`) + one family per student with no household. Compute it with
  // aggregate counts instead of pulling every student row across the wire:
  // total students, unassigned (singleton) students, and households that have
  // any student via a relation filter — the latter is exactly the number of
  // distinct non-null household ids referenced by the roster.
  const [studentCount, singletonStudentCount, householdsWithStudents, classroomCount] =
    await Promise.all([
      prisma.student.count({ where: { orgId } }),
      prisma.student.count({ where: { orgId, householdId: null } }),
      prisma.household.count({ where: { orgId, students: { some: {} } } }),
      prisma.teacher.count({ where: { orgId } }),
    ]);

  return {
    students: studentCount,
    families: singletonStudentCount + householdsWithStudents,
    classrooms: classroomCount,
  };
}

function maxRatio(count: number, cap: number): number {
  if (cap <= 0) return 0;
  return count / cap;
}

export function buildUsageSnapshot(
  org: Pick<Org, "billingPlan" | "usageGraceStartedAt" | "limitStudents" | "limitFamilies" | "limitClassrooms">,
  counts: UsageCounts,
  now: Date,
): UsageSnapshot {
  const limits = getNumericLimits(org.billingPlan, org);
  const tier = resolveLimitTier(org.billingPlan);

  if (!limits) {
    return {
      counts,
      limits: null,
      tier,
      shouldWarn: false,
      overCap: false,
      graceActive: false,
      graceExpiredOverCap: false,
      worstLevel: "ok",
    };
  }

  const dims: (keyof NumericPlanLimits)[] = ["students", "families", "classrooms"];
  let shouldWarn = false;
  let overCap = false;
  let maxOverRatio = 0;

  for (const d of dims) {
    const cap = limits[d];
    const c = counts[d];
    if (c >= warnThreshold(cap)) shouldWarn = true;
    if (c > cap) {
      overCap = true;
      maxOverRatio = Math.max(maxOverRatio, maxRatio(c, cap));
    }
  }

  const graceStart = org.usageGraceStartedAt;
  const graceEnd = graceStart ? addDaysUtc(graceStart, USAGE_GRACE_DAYS) : null;
  const graceActive = !!(graceStart && now.getTime() <= graceEnd!.getTime() && overCap);
  const graceExpiredOverCap = !!(
    graceStart &&
    now.getTime() > graceEnd!.getTime() &&
    overCap
  );

  let worstLevel: UsageLevel = "ok";
  if (graceExpiredOverCap) worstLevel = "grace_expired";
  else if (overCap && graceActive) worstLevel = "grace";
  else if (overCap) worstLevel = "over_cap";
  else if (shouldWarn) worstLevel = "warn";

  return {
    counts,
    limits,
    tier,
    shouldWarn,
    overCap,
    graceActive,
    graceExpiredOverCap,
    worstLevel,
  };
}

export class PlanLimitError extends Error {
  readonly code = "PLAN_LIMIT";

  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

function assertDimension(
  name: keyof NumericPlanLimits,
  next: number,
  limits: NumericPlanLimits,
  org: Pick<Org, "usageGraceStartedAt">,
  now: Date,
): void {
  const cap = limits[name];
  const hard = hardCeiling(cap);

  if (next <= cap) return;

  const graceStart = org.usageGraceStartedAt;
  const graceEnd = graceStart ? addDaysUtc(graceStart, USAGE_GRACE_DAYS) : null;
  const inGracePeriod = graceStart && now.getTime() <= graceEnd!.getTime();

  if (next > hard) {
    throw new PlanLimitError(
      `This change would exceed your plan’s maximum (${name}: ${hard} during the grace window, ${cap} after). Upgrade your plan or remove records.`,
    );
  }

  if (next > cap && graceStart && now.getTime() > graceEnd!.getTime()) {
    throw new PlanLimitError(
      `Your plan allows up to ${cap} ${name} (30-day grace period ended). Upgrade your plan or reduce usage.`,
    );
  }

  if (next > cap && !graceStart) {
    // Will start grace on commit — allowed up to hard
    return;
  }

  if (next > cap && inGracePeriod) {
    return;
  }
}

/**
 * Call before adding students (and new families when household is new).
 */
export function assertUsageAllowsIncrement(
  org: Pick<Org, "billingPlan" | "usageGraceStartedAt" | "limitStudents" | "limitFamilies" | "limitClassrooms">,
  current: UsageCounts,
  delta: { students: number; families: number; classrooms: number },
  now = new Date(),
): void {
  const limits = getNumericLimits(org.billingPlan, org);
  if (!limits) return;

  const next: UsageCounts = {
    students: current.students + delta.students,
    families: current.families + delta.families,
    classrooms: current.classrooms + delta.classrooms,
  };

  assertDimension("students", next.students, limits, org, now);
  assertDimension("families", next.families, limits, org, now);
  assertDimension("classrooms", next.classrooms, limits, org, now);
}

/**
 * After writes, set or clear org.usageGraceStartedAt.
 */
export async function syncUsageGracePeriod(
  prisma: PrismaClient,
  org: Org,
  counts: UsageCounts,
  now = new Date(),
): Promise<void> {
  const limits = getNumericLimits(org.billingPlan, org);
  if (!limits) {
    if (org.usageGraceStartedAt) {
      await prisma.org.update({
        where: { id: org.id },
        data: { usageGraceStartedAt: null },
      });
    }
    return;
  }

  const over =
    counts.students > limits.students ||
    counts.families > limits.families ||
    counts.classrooms > limits.classrooms;

  const allUnderOrAtCap =
    counts.students <= limits.students &&
    counts.families <= limits.families &&
    counts.classrooms <= limits.classrooms;

  if (over && !org.usageGraceStartedAt) {
    await prisma.org.update({
      where: { id: org.id },
      data: { usageGraceStartedAt: now },
    });
    return;
  }

  if (allUnderOrAtCap && org.usageGraceStartedAt) {
    await prisma.org.update({
      where: { id: org.id },
      data: { usageGraceStartedAt: null },
    });
  }
}
