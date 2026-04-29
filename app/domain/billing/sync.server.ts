import type Stripe from "stripe";
import { getPrisma } from "~/db.server";
import { requireStripeConfig } from "~/domain/billing/stripe.server";
import {
  reconcileOrgStatus,
  resolveBillingState,
} from "~/domain/billing/state.server";

export async function applySubscriptionToOrg(
  context: any,
  subscription: Stripe.Subscription,
) {
  const db = getPrisma(context);
  const orgId = subscription.metadata?.orgId ?? null;
  const customerId = subscription.customer
    ? String(subscription.customer)
    : null;
  const org = orgId
    ? await db.org.findUnique({ where: { id: orgId } })
    : customerId
      ? await db.org.findUnique({
          where: { stripeCustomerId: customerId },
        })
      : null;

  if (!org) return;

  const config = requireStripeConfig(context);
  const state = resolveBillingState({ subscription, config });
  const reconciled = reconcileOrgStatus({
    orgRow: {
      status: org.status,
      trialEndsAt: org.trialEndsAt,
      pastDueSinceAt: org.pastDueSinceAt,
    },
    billingState: state,
    now: new Date(),
  });

  // Stamp stripeCustomerId if we matched by metadata and the org didn't have one yet.
  const stripeCustomerIdUpdate =
    !org.stripeCustomerId && customerId ? { stripeCustomerId: customerId } : {};

  await db.org.update({
    where: { id: org.id },
    data: {
      ...stripeCustomerIdUpdate,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: state.subscriptionStatus,
      status: reconciled.status,
      billingPlan: state.plan,
      pastDueSinceAt: reconciled.pastDueSinceAt,
    },
  });
}
