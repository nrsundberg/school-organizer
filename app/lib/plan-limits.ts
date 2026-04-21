/** Warn admins when any metric reaches this fraction of the plan cap. */
export const USAGE_WARN_FRACTION = 0.8;

/** During grace, org may grow to this fraction of each cap (then must upgrade). */
export const USAGE_GRACE_HARD_FRACTION = 1.1;

/** Days after first exceeding 100% of any cap before enforcement tightens. */
export const USAGE_GRACE_DAYS = 30;

export type PlanLimitTier = "FREE" | "CAR_LINE" | "CAMPUS" | "ENTERPRISE";

export type NumericPlanLimits = {
  students: number;
  families: number;
  classrooms: number;
};

/** Published caps — keep in sync with marketing. */
export const PLAN_LIMITS: Record<Exclude<PlanLimitTier, "ENTERPRISE">, NumericPlanLimits> = {
  FREE: {
    students: 400,
    families: 150,
    classrooms: 35,
  },
  CAR_LINE: {
    students: 400,
    families: 150,
    classrooms: 35,
  },
  CAMPUS: {
    students: 900,
    families: 300,
    classrooms: 80,
  },
};

export function warnThreshold(cap: number): number {
  return Math.floor(cap * USAGE_WARN_FRACTION);
}

export function hardCeiling(cap: number): number {
  return Math.floor(cap * USAGE_GRACE_HARD_FRACTION);
}

/**
 * Advanced branding — custom domain mapping + tenant logo upload — is a
 * CAMPUS+ feature. FREE / CAR_LINE / STARTER tenants see colors only.
 * Passing an unknown string is treated as disallowed.
 */
export function planAllowsAdvancedBranding(
  billingPlan: string | null | undefined,
): boolean {
  return (
    billingPlan === "CAMPUS" ||
    billingPlan === "DISTRICT" ||
    billingPlan === "ENTERPRISE"
  );
}
