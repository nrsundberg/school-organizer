import type { BillingPlan } from "~/db";
import { getPrisma } from "~/db.server";
import { requireStripeConfig } from "~/domain/billing/stripe.server";
import { mapStripeSubscriptionStatusToOrgStatus } from "~/domain/billing/org-status";
import { addDaysUtc } from "~/domain/billing/trial.server";

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

export function slugifyOrgName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function uniqueOrgSlug(
  context: any,
  requestedSlug: string,
): Promise<string> {
  const db = getPrisma(context);
  const base = requestedSlug || "org";
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await db.org.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
  }
  throw new Error("Unable to generate unique org slug.");
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

  const slug = await uniqueOrgSlug(context, requestedSlug);

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

  if (plan !== "FREE") {
    const stripe = requireStripeConfig(context);
    const customer = await stripe.client.customers.create({
      email,
      name: org.name,
      metadata: { orgId: org.id, slug: org.slug },
    });
    const subscription = await stripe.client.subscriptions.create({
      customer: customer.id,
      items: [{ price: stripe.starterPriceId }],
      metadata: { orgId: org.id },
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

