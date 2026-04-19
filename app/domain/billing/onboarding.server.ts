import type { BillingPlan } from "~/db";
import { getPrisma } from "~/db.server";
import { requireStripeConfig } from "~/domain/billing/stripe.server";
import { mapStripeSubscriptionStatusToOrgStatus } from "~/domain/billing/org-status";
import { addDaysUtc } from "~/domain/billing/trial.server";
import { slugifyOrgName } from "~/lib/org-slug";

export { slugifyOrgName };

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

export async function ensureOrgForUser(params: {
  context: any;
  userId: string;
  orgName: string;
  requestedSlug: string;
  plan?: BillingPlan;
  email: string;
}): Promise<{ orgId: string; plan: BillingPlan }> {
  const { context, userId, orgName, requestedSlug, email } = params;
  const plan: BillingPlan = params.plan ?? "FREE";
  const db = getPrisma(context);

  const existingUser = await db.user.findUnique({ where: { id: userId } });
  if (!existingUser) throw new Error("User not found.");
  if (existingUser.orgId) {
    return { orgId: existingUser.orgId, plan };
  }

  const slug = slugifyOrgName(requestedSlug);
  if (!slug) {
    throw new Error("A valid organization slug is required.");
  }

  const taken = await db.org.findUnique({ where: { slug } });
  if (taken) {
    throw new Error("That slug is already taken. Choose another or verify availability again.");
  }

  const trialStartedAt = new Date();
  const org = await db.org.create({
    data: {
      name: orgName.trim(),
      slug,
      billingPlan: plan,
      status: plan === "FREE" ? "TRIALING" : "INCOMPLETE",
      trialStartedAt,
      trialQualifyingPickupDays: 0,
      trialEndsAt: addDaysUtc(trialStartedAt, 30),
    },
  });

  let stripeCustomerId: string | undefined;
  let stripeSubscriptionId: string | undefined;
  let subscriptionStatus: string | undefined;

  if (plan !== "FREE" && plan !== "ENTERPRISE") {
    const stripe = requireStripeConfig(context);
    const priceId =
      plan === "CAR_LINE" ? stripe.carLinePriceId : stripe.campusPriceId;
    const customer = await stripe.client.customers.create({
      email,
      name: org.name,
      metadata: { orgId: org.id, slug: org.slug },
    });
    const subscription = await stripe.client.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      metadata: { orgId: org.id, billingPlan: plan },
    });
    stripeCustomerId = customer.id;
    stripeSubscriptionId = subscription.id;
    subscriptionStatus = subscription.status;
  }

  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: { orgId: org.id },
    }),
    db.org.update({
      where: { id: org.id },
      data: {
        stripeCustomerId,
        stripeSubscriptionId,
        subscriptionStatus: toSubscriptionStatus(subscriptionStatus),
        status: subscriptionStatus
          ? mapStripeSubscriptionStatusToOrgStatus(subscriptionStatus)
          : "INCOMPLETE",
      },
    }),
  ]);

  return { orgId: org.id, plan };
}

