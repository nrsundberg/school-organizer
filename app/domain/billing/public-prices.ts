/**
 * Public self-serve prices. Stripe Price IDs are NOT stored here — they live
 * in Worker secrets (see docs/stripe-products.md and
 * scripts/stripe-create-prices.ts). This module is the single source for the
 * amounts shown on /pricing, signup, and the Stripe setup script.
 *
 * Annual prices are 20% off twelve months of the monthly rate:
 *   Car Line  $150 × 12 × 0.8 = $1,440 / year
 *   Campus    $500 × 12 × 0.8 = $4,800 / year
 * District stays custom and has no public amount.
 */

export const ANNUAL_DISCOUNT_PERCENT = 20;

export const PUBLIC_PLAN_PRICES = {
  CAR_LINE: {
    monthlyDollars: 150,
    annualDollars: 1440,
  },
  CAMPUS: {
    monthlyDollars: 500,
    annualDollars: 4800,
  },
} as const;

export type SelfServePricePlan = keyof typeof PUBLIC_PLAN_PRICES;
export type PublicPriceCycle = "monthly" | "annual";

export type StripePriceSpec = {
  plan: SelfServePricePlan;
  cycle: PublicPriceCycle;
  /** Worker secret that must hold this Price ID (`price_...`). */
  envVar: string;
  /** Stable Stripe lookup_key. Unique per Stripe account. */
  lookupKey: string;
  productName: string;
  productDescription: string;
  interval: "month" | "year";
  unitAmountCents: number;
};

export const STRIPE_PRICE_SPECS: readonly StripePriceSpec[] = [
  {
    plan: "CAR_LINE",
    cycle: "monthly",
    envVar: "STRIPE_CAR_LINE_PRICE_ID",
    lookupKey: "pickuproster_car_line_monthly",
    productName: "Car Line",
    productDescription:
      "PickupRoster Car Line — staff dismissal board. $150 USD per month.",
    interval: "month",
    unitAmountCents: PUBLIC_PLAN_PRICES.CAR_LINE.monthlyDollars * 100,
  },
  {
    plan: "CAR_LINE",
    cycle: "annual",
    envVar: "STRIPE_CAR_LINE_ANNUAL_PRICE_ID",
    lookupKey: "pickuproster_car_line_annual",
    productName: "Car Line",
    productDescription:
      "PickupRoster Car Line — staff dismissal board. $1,440 USD per year (20% off monthly).",
    interval: "year",
    unitAmountCents: PUBLIC_PLAN_PRICES.CAR_LINE.annualDollars * 100,
  },
  {
    plan: "CAMPUS",
    cycle: "monthly",
    envVar: "STRIPE_CAMPUS_PRICE_ID",
    lookupKey: "pickuproster_campus_monthly",
    productName: "Campus",
    productDescription:
      "PickupRoster Campus — parent app and higher caps. $500 USD per month.",
    interval: "month",
    unitAmountCents: PUBLIC_PLAN_PRICES.CAMPUS.monthlyDollars * 100,
  },
  {
    plan: "CAMPUS",
    cycle: "annual",
    envVar: "STRIPE_CAMPUS_ANNUAL_PRICE_ID",
    lookupKey: "pickuproster_campus_annual",
    productName: "Campus",
    productDescription:
      "PickupRoster Campus — parent app and higher caps. $4,800 USD per year (20% off monthly).",
    interval: "year",
    unitAmountCents: PUBLIC_PLAN_PRICES.CAMPUS.annualDollars * 100,
  },
];

export function dollarsForPlan(
  plan: SelfServePricePlan,
  cycle: PublicPriceCycle,
): number {
  const prices = PUBLIC_PLAN_PRICES[plan];
  return cycle === "annual" ? prices.annualDollars : prices.monthlyDollars;
}

/** Twelve months at the monthly rate, before the annual discount. */
export function undiscountedAnnualDollars(plan: SelfServePricePlan): number {
  return PUBLIC_PLAN_PRICES[plan].monthlyDollars * 12;
}

export function annualSavingsDollars(plan: SelfServePricePlan): number {
  return undiscountedAnnualDollars(plan) - PUBLIC_PLAN_PRICES[plan].annualDollars;
}

export function formatUsdDollars(amount: number, locale = "en-US"): string {
  return amount.toLocaleString(locale, { maximumFractionDigits: 0 });
}

export type PublicPriceDisplay = {
  dollars: number;
  formatted: string;
  annualFormatted: string;
  undiscountedAnnualFormatted: string;
  savePercent: number;
};

/** Numbers the pricing page renders for a plan and billing cycle. */
export function publicPriceDisplay(
  plan: SelfServePricePlan,
  cycle: PublicPriceCycle,
  locale = "en-US",
): PublicPriceDisplay {
  return {
    dollars: dollarsForPlan(plan, cycle),
    formatted: formatUsdDollars(dollarsForPlan(plan, cycle), locale),
    annualFormatted: formatUsdDollars(PUBLIC_PLAN_PRICES[plan].annualDollars, locale),
    undiscountedAnnualFormatted: formatUsdDollars(
      undiscountedAnnualDollars(plan),
      locale,
    ),
    savePercent: ANNUAL_DISCOUNT_PERCENT,
  };
}
