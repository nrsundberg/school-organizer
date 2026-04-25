import type { BillingPlan } from "~/db";
import { getPrisma } from "~/db.server";
import { addDaysUtc } from "~/domain/billing/trial.server";
import { slugifyOrgName } from "~/lib/org-slug";
import { enqueueEmail } from "~/domain/email/queue.server";

export { slugifyOrgName };

export async function ensureOrgForUser(params: {
  context: any;
  userId: string;
  orgName: string;
  requestedSlug: string;
  plan?: BillingPlan;
  email: string;
}): Promise<{ orgId: string; plan: BillingPlan; created: boolean }> {
  const { context, userId, orgName, requestedSlug, email } = params;
  // Public signups pass CAR_LINE or DISTRICT. FREE is reserved for comped
  // orgs created by staff from the platform admin panel. The old behavior
  // (missing plan -> FREE) is retained for the admin "create comped org"
  // flow which passes plan: "FREE" explicitly.
  const plan: BillingPlan = params.plan ?? "CAR_LINE";
  const db = getPrisma(context);

  const existingUser = await db.user.findUnique({ where: { id: userId } });
  if (!existingUser) throw new Error("User not found.");
  if (existingUser.orgId) {
    return { orgId: existingUser.orgId, plan, created: false };
  }
  // Recipient locale for the welcome email — falls through to "en" via the
  // template default if the column hasn't been backfilled yet.
  const recipientLocale = (existingUser as { locale?: string }).locale;

  const slug = slugifyOrgName(requestedSlug);
  if (!slug) {
    throw new Error("A valid organization slug is required.");
  }

  const taken = await db.org.findUnique({ where: { slug } });
  if (taken) {
    throw new Error("That slug is already taken. Choose another or verify availability again.");
  }

  const trialStartedAt = new Date();
  const trialEndsAt = addDaysUtc(trialStartedAt, 30);
  // Every new org gets a 30-day trial window regardless of plan tier, so the
  // initial status must reflect that: TRIALING. Previously paid-plan orgs were
  // created as INCOMPLETE and only promoted when the Stripe
  // customer.subscription.created (status=trialing) webhook arrived — if the
  // webhook raced the first page load, the org was stuck on the "Billing
  // Action Required" screen despite having a valid trial. INCOMPLETE should
  // only apply to orgs without a usable trial window (e.g. post-trial orgs
  // that failed payment collection). See migrations/0015 for the one-shot
  // backfill of pre-existing stranded orgs.
  const org = await db.org.create({
    data: {
      name: orgName.trim(),
      slug,
      billingPlan: plan,
      status: "TRIALING",
      trialStartedAt,
      trialQualifyingPickupDays: 0,
      trialEndsAt,
    },
  });

  // Attach the signup user as the org's first ADMIN. The user who creates an
  // org is always the initial admin — they need to invite additional users,
  // configure branding, billing, etc.
  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: { orgId: org.id, role: "ADMIN" },
    }),
  ]);

  // Fire-and-forget welcome email via the EMAIL_QUEUE. Failures here must not
  // block signup — enqueueEmail swallows errors and logs.
  try {
    await enqueueEmail(context, {
      kind: "welcome",
      to: email,
      orgName: orgName.trim(),
      orgSlug: slug,
      userName: existingUser.name || null,
      locale: recipientLocale,
    });
  } catch (err) {
    console.error("enqueueEmail(welcome) failed", err);
  }

  return { orgId: org.id, plan, created: true };
}
