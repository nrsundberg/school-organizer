import Stripe from "stripe";

export type BillingCycle = "monthly" | "annual";

export type StripeConfig = {
  client: Stripe;
  /** Car Line (base) monthly price */
  carLinePriceId: string;
  /** Car Line (base) annual price (optional) */
  carLineAnnualPriceId: string | null;
  /** Campus tier monthly price */
  campusPriceId: string;
  /** Campus tier annual price (optional) */
  campusAnnualPriceId: string | null;
  webhookSecret: string;
};

function readEnv(context: any, key: string): string | undefined {
  return context?.cloudflare?.env?.[key] ?? process.env[key];
}

export function getStripeConfig(context: any): StripeConfig | null {
  const secretKey = readEnv(context, "STRIPE_SECRET_KEY");
  const webhookSecret = readEnv(context, "STRIPE_WEBHOOK_SECRET");
  const carLinePriceId =
    readEnv(context, "STRIPE_CAR_LINE_PRICE_ID") ?? readEnv(context, "STRIPE_STARTER_PRICE_ID");
  const campusPriceId =
    readEnv(context, "STRIPE_CAMPUS_PRICE_ID") ?? readEnv(context, "STRIPE_STARTER_PRICE_ID");
  const carLineAnnualPriceId = readEnv(context, "STRIPE_CAR_LINE_ANNUAL_PRICE_ID") ?? null;
  const campusAnnualPriceId = readEnv(context, "STRIPE_CAMPUS_ANNUAL_PRICE_ID") ?? null;

  if (!secretKey || !carLinePriceId || !campusPriceId || !webhookSecret) {
    return null;
  }

  return {
    client: new Stripe(secretKey),
    carLinePriceId,
    carLineAnnualPriceId,
    campusPriceId,
    campusAnnualPriceId,
    webhookSecret,
  };
}

export function requireStripeConfig(context: any): StripeConfig {
  const config = getStripeConfig(context);
  if (!config) {
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY, STRIPE_CAR_LINE_PRICE_ID, STRIPE_CAMPUS_PRICE_ID, STRIPE_WEBHOOK_SECRET (or legacy STRIPE_STARTER_PRICE_ID for both prices in dev). Annual prices via STRIPE_CAR_LINE_ANNUAL_PRICE_ID / STRIPE_CAMPUS_ANNUAL_PRICE_ID are optional.",
    );
  }
  return config;
}

/**
 * All known price IDs for a given plan (monthly first, then annual if configured).
 * Used by the webhook handler to map a subscription's first line item back to a plan.
 */
export function priceIdsForPlan(
  cfg: StripeConfig,
  plan: "CAR_LINE" | "CAMPUS",
): string[] {
  if (plan === "CAR_LINE") {
    return [cfg.carLinePriceId, cfg.carLineAnnualPriceId].filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
  }
  return [cfg.campusPriceId, cfg.campusAnnualPriceId].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
}
