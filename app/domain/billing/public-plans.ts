export const PUBLIC_PLAN_SLUGS = ["car-line", "campus", "district"] as const;
export type PublicPlanSlug = (typeof PUBLIC_PLAN_SLUGS)[number];

export const PUBLIC_BILLING_CYCLES = ["monthly", "annual"] as const;
export type PublicBillingCycle = (typeof PUBLIC_BILLING_CYCLES)[number];

export type SelfServeBillingPlan = "CAR_LINE" | "CAMPUS";
export type PublicBillingPlan = SelfServeBillingPlan | "DISTRICT";

export function normalizePublicPlan(raw: string | null): PublicPlanSlug | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "car-line" || v === "car_line" || v === "carline") {
    return "car-line";
  }
  if (v === "campus") return "campus";
  if (v === "district") return "district";
  return null;
}

export function normalizePublicBillingCycle(
  raw: string | null,
): PublicBillingCycle {
  return raw?.trim().toLowerCase() === "annual" ? "annual" : "monthly";
}

export function billingPlanForSlug(slug: PublicPlanSlug): PublicBillingPlan {
  if (slug === "district") return "DISTRICT";
  if (slug === "campus") return "CAMPUS";
  return "CAR_LINE";
}

export function slugForBillingPlan(plan: PublicBillingPlan): PublicPlanSlug {
  if (plan === "DISTRICT") return "district";
  if (plan === "CAMPUS") return "campus";
  return "car-line";
}

export function isSelfServeBillingPlan(
  plan: PublicBillingPlan,
): plan is SelfServeBillingPlan {
  return plan === "CAR_LINE" || plan === "CAMPUS";
}

export function planLabel(plan: PublicBillingPlan): string {
  if (plan === "DISTRICT") return "District";
  if (plan === "CAMPUS") return "Campus";
  return "Car Line";
}

export function billingCycleLabel(cycle: PublicBillingCycle): string {
  return cycle === "annual" ? "Annual" : "Monthly";
}

export function signupPathForPlan(
  plan: PublicPlanSlug,
  billingCycle: PublicBillingCycle,
): string {
  const params = new URLSearchParams({
    plan,
    cycle: billingCycle,
  });
  return `/signup?${params.toString()}`;
}

export function pricingPathForPlan(
  plan: PublicBillingPlan,
  billingCycle: PublicBillingCycle,
): string {
  const params = new URLSearchParams({
    plan: slugForBillingPlan(plan),
    cycle: billingCycle,
  });
  return `/pricing?${params.toString()}`;
}
