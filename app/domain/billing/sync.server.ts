import type Stripe from "stripe";
import type { OrgStatus } from "~/db";
import { getPrisma } from "~/db.server";
import { getStripeConfig } from "~/domain/billing/stripe.server";
import { mapStripeSubscriptionStatusToOrgStatus } from "~/domain/billing/org-status";

export function toSubscriptionStatus(
  value: string | null | undefined,
):
  | "INCOMPLETE"
  | "INCOMPLETE_EXPIRED"
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "UNPAID"
  | null {
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

export function billingPlanFromStripePrice(
  context: any,
  priceId: string | undefined,
): "FREE" | "CAR_LINE" | "CAMPUS" {
  const cfg = getStripeConfig(context);
  if (!cfg || !priceId) return "CAMPUS";
  if (priceId === cfg.carLinePriceId || priceId === cfg.carLineAnnualPriceId) {
    return "CAR_LINE";
  }
  if (priceId === cfg.campusPriceId || priceId === cfg.campusAnnualPriceId) {
    return "CAMPUS";
  }
  return "CAMPUS";
}

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

  const priceId = subscription.items.data[0]?.price?.id;
  const hasItems = subscription.items.data.length > 0;
  const billingPlan = !hasItems
    ? "FREE"
    : billingPlanFromStripePrice(context, priceId);

  const subStatus = subscription.status;
  const subscriptionStatus = toSubscriptionStatus(subStatus);
  const mappedOrgStatus = mapStripeSubscriptionStatusToOrgStatus(subStatus);

  let pastDueSinceAt: Date | null;
  let status: OrgStatus;

  // If the org has a valid in-progress trial window, treat that as the floor:
  // Stripe can legitimately send `incomplete` (SCA hold on the first invoice)
  // or unknown statuses while the trial is still running, and we must not
  // demote an active trial into the "Billing Action Required" state. Webhooks
  // for clear terminal states (canceled, incomplete_expired, unpaid) still
  // win and move the org to its mapped status.
  const now = new Date();
  const hasActiveTrial =
    !!org.trialEndsAt && new Date(org.trialEndsAt).getTime() > now.getTime();

  if (subStatus === "past_due") {
    pastDueSinceAt = org.pastDueSinceAt ?? new Date();
    status = org.status === "SUSPENDED" ? "SUSPENDED" : mappedOrgStatus;
  } else if (subStatus === "active" || subStatus === "trialing") {
    pastDueSinceAt = null;
    status = mappedOrgStatus;
  } else if (
    (subStatus === "incomplete" || !subscriptionStatus) &&
    hasActiveTrial
  ) {
    // Paid-plan onboarding race: Stripe reports `incomplete` (or sends an
    // unrecognized status) before the trial officially starts, but the org
    // already has a valid trial window locally. Keep it TRIALING.
    pastDueSinceAt = null;
    status = "TRIALING";
  } else {
    pastDueSinceAt = null;
    status = mappedOrgStatus;
  }

  // Stamp stripeCustomerId if we matched by metadata and the org didn't have one yet.
  const stripeCustomerIdUpdate =
    !org.stripeCustomerId && customerId ? { stripeCustomerId: customerId } : {};

  await db.org.update({
    where: { id: org.id },
    data: {
      ...stripeCustomerIdUpdate,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus,
      status,
      billingPlan,
      pastDueSinceAt,
    },
  });
}
