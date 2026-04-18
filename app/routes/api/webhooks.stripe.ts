import { data } from "react-router";
import type { Route } from "./+types/webhooks.stripe";
import { getPrisma } from "~/db.server";
import { getStripeConfig, requireStripeConfig } from "~/domain/billing/stripe.server";
import { mapStripeSubscriptionStatusToOrgStatus } from "~/domain/billing/org-status";
import type Stripe from "stripe";

function toSubscriptionStatus(
  value: string | null | undefined,
): "INCOMPLETE" | "INCOMPLETE_EXPIRED" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "UNPAID" | null {
  switch (value) {
    case "incomplete":
      return "INCOMPLETE";
    case "incomplete_expired":
      return "INCOMPLETE_EXPIRED";
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "unpaid":
      return "UNPAID";
    default:
      return null;
  }
}

async function applySubscriptionToOrg(
  context: any,
  subscription: Stripe.Subscription,
) {
  const db = getPrisma(context);
  const orgId = subscription.metadata?.orgId ?? null;
  const org = orgId
    ? await db.org.findUnique({ where: { id: orgId } })
    : subscription.customer
      ? await db.org.findUnique({
          where: { stripeCustomerId: String(subscription.customer) },
        })
      : null;

  if (!org) return;

  await db.org.update({
    where: { id: org.id },
    data: {
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: toSubscriptionStatus(subscription.status),
      status: mapStripeSubscriptionStatusToOrgStatus(subscription.status),
      billingPlan: subscription.items.data.length > 0 ? "STARTER" : "FREE",
    },
  });
}

export async function action({ request, context }: Route.ActionArgs) {
  if (!getStripeConfig(context)) {
    return data({ ok: true, skipped: "Stripe not configured." });
  }

  const stripe = requireStripeConfig(context);
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return data({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.client.webhooks.constructEventAsync(
      payload,
      signature,
      stripe.webhookSecret,
    );
  } catch {
    return data({ error: "Invalid webhook signature." }, { status: 400 });
  }

  const db = getPrisma(context);
  const existing = await db.stripeWebhookEvent.findUnique({
    where: { stripeEventId: event.id },
  });
  if (existing) {
    return data({ ok: true, deduped: true });
  }

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await applySubscriptionToOrg(context, event.data.object as Stripe.Subscription);
      break;
    }
    default:
      break;
  }

  await db.stripeWebhookEvent.create({
    data: {
      stripeEventId: event.id,
      type: event.type,
    },
  });

  return data({ ok: true });
}

