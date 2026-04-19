import Stripe from "stripe";

type StripeConfig = {
  client: Stripe;
  /** Car Line (base) monthly price */
  carLinePriceId: string;
  /** Campus tier monthly price */
  campusPriceId: string;
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

  if (!secretKey || !carLinePriceId || !campusPriceId || !webhookSecret) {
    return null;
  }

  return {
    client: new Stripe(secretKey),
    carLinePriceId,
    campusPriceId,
    webhookSecret,
  };
}

export function requireStripeConfig(context: any): StripeConfig {
  const config = getStripeConfig(context);
  if (!config) {
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY, STRIPE_CAR_LINE_PRICE_ID, STRIPE_CAMPUS_PRICE_ID, STRIPE_WEBHOOK_SECRET (or legacy STRIPE_STARTER_PRICE_ID for both prices in dev).",
    );
  }
  return config;
}

