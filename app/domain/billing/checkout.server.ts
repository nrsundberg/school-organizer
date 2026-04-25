import { getPrisma } from "~/db.server";
import {
  requireStripeConfig,
  type BillingCycle,
  type StripeConfig,
} from "~/domain/billing/stripe.server";

type BillingDb = {
  org: {
    findUnique(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
};

/**
 * Resolve the Stripe Price ID for a plan + billing cycle.
 * Falls back to the monthly price if an annual price isn't configured.
 */
export function priceIdForPlan(
  cfg: StripeConfig,
  plan: "CAR_LINE" | "CAMPUS",
  billingCycle: BillingCycle = "monthly",
): string {
  if (plan === "CAR_LINE") {
    if (billingCycle === "annual" && cfg.carLineAnnualPriceId) {
      return cfg.carLineAnnualPriceId;
    }
    return cfg.carLinePriceId;
  }
  if (billingCycle === "annual" && cfg.campusAnnualPriceId) {
    return cfg.campusAnnualPriceId;
  }
  return cfg.campusPriceId;
}

export async function ensureStripeCustomerForOrg(params: {
  context: any;
  orgId: string;
  email: string;
  db?: BillingDb;
  stripeConfig?: StripeConfig;
}): Promise<string> {
  const { context, orgId, email } = params;
  const db = params.db ?? getPrisma(context);
  const org = await db.org.findUnique({ where: { id: orgId } });
  if (!org) {
    throw new Response("Org not found.", { status: 404 });
  }
  if (org.stripeCustomerId) {
    return org.stripeCustomerId;
  }

  const stripe = params.stripeConfig ?? requireStripeConfig(context);
  const customer = await stripe.client.customers.create({
    email,
    name: org.name,
    metadata: { orgId: org.id, slug: org.slug },
  });
  await db.org.update({
    where: { id: org.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

export async function createCheckoutSessionForOrg(params: {
  context: any;
  orgId: string;
  plan: "CAR_LINE" | "CAMPUS";
  billingCycle?: BillingCycle;
  email: string;
  successUrl: string;
  cancelUrl: string;
  db?: BillingDb;
  stripeConfig?: StripeConfig;
  /**
   * Optional BCP-47 short locale (e.g. "en", "es") for Stripe-hosted
   * Checkout. Stripe accepts a fixed list of values plus "auto"; we pass
   * the caller's value through and fall back to "auto" when omitted so
   * Stripe picks based on the visitor's browser preferences.
   */
  locale?: string;
}): Promise<{ url: string }> {
  const {
    context,
    orgId,
    plan,
    billingCycle = "monthly",
    email,
    successUrl,
    cancelUrl,
    locale,
  } = params;
  const stripe = params.stripeConfig ?? requireStripeConfig(context);
  const customer = await ensureStripeCustomerForOrg({
    context,
    orgId,
    email,
    db: params.db,
    stripeConfig: stripe,
  });

  const session = await stripe.client.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [
      { price: priceIdForPlan(stripe, plan, billingCycle), quantity: 1 },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Stripe Checkout localizes its own UI when a `locale` is provided. Map
    // our supported codes through; everything else falls back to "auto".
    locale: stripeCheckoutLocale(locale),
    metadata: { orgId, billingPlan: plan, billingCycle },
    subscription_data: {
      metadata: { orgId, billingPlan: plan, billingCycle },
    },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout session URL.");
  }

  return { url: session.url };
}

/**
 * Map our internal BCP-47 short codes to Stripe Checkout's `locale` enum.
 * Returns `"auto"` for unknown / missing values so Stripe falls back to the
 * visitor's browser language.
 */
function stripeCheckoutLocale(
  lng: string | null | undefined,
): "auto" | "en" | "es" {
  switch (lng) {
    case "en":
      return "en";
    case "es":
      return "es";
    default:
      return "auto";
  }
}

export async function createBillingPortalSessionForOrg(params: {
  context: any;
  orgId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const { context, orgId, returnUrl } = params;
  const db = getPrisma(context);
  const org = await db.org.findUnique({ where: { id: orgId } });
  if (!org || !org.stripeCustomerId) {
    throw new Response("No Stripe customer for this org.", { status: 400 });
  }

  const stripe = requireStripeConfig(context);
  const session = await stripe.client.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: returnUrl,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a billing portal URL.");
  }

  return { url: session.url };
}
