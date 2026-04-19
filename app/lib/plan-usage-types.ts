import type { NumericPlanLimits, PlanLimitTier } from "~/lib/plan-limits";

export type UsageCounts = {
  students: number;
  families: number;
  classrooms: number;
};

export type UsageLevel = "ok" | "warn" | "over_cap" | "grace" | "grace_expired";

export type UsageSnapshot = {
  counts: UsageCounts;
  limits: NumericPlanLimits | null;
  tier: PlanLimitTier;
  shouldWarn: boolean;
  overCap: boolean;
  graceActive: boolean;
  graceExpiredOverCap: boolean;
  worstLevel: UsageLevel;
};
