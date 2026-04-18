import Stripe from "stripe";

type StripeConfig = {
  client: Stripe;
  starterPriceId: string;
  webhookSecret: string;
};

function readEnv(context: any, key: string): string | undefined {
  return context?.cloudflare?.env?.[key] ?? process.env[key];
}

export function getStripeConfig(context: any): StripeConfig | null {
  const secretKey = readEnv(context, "STRIPE_SECRET_KEY");
  const starterPriceId = readEnv(context, "STRIPE_STARTER_PRICE_ID");
  const webhookSecret = readEnv(context, "STRIPE_WEBHOOK_SECRET");

  if (!secretKey || !starterPriceId || !webhookSecret) {
    return null;
  }

  return {
    client: new Stripe(secretKey),
    starterPriceId,
    webhookSecret,
  };
}

export function requireStripeConfig(context: any): StripeConfig {
  const config = getStripeConfig(context);
  if (!config) {
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY, STRIPE_STARTER_PRICE_ID, and STRIPE_WEBHOOK_SECRET.",
    );
  }
  return config;
}

