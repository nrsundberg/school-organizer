import type Stripe from "stripe";
import type { OrgStatus, StripeSubscriptionStatus } from "~/db";
import type { StripeConfig } from "./stripe.server";

export type BillingPlanCode = "FREE" | "CAR_LINE" | "CAMPUS";
export type BillingCycle = "monthly" | "annual";

export type BillingStateWarning =
  | { code: "UNKNOWN_PRICE"; priceId: string }
  | { code: "UNKNOWN_STATUS"; raw: string };

/**
 * The full Stripe-derived view of an org's billing state.
 *
 * **Strictly Stripe-derived** — does not consult the DB. Comp / trial-floor
 * decisions (e.g. "subscription says incomplete but our trial is still
 * running, keep TRIALING") live in `reconcileOrgStatus`, which composes this
 * state with the persisted org row.
 *
 * `subscriptionStatus` is `null` only when Stripe sends a status string we
 * don't recognize; in that case `orgStatus` falls back to `"INCOMPLETE"` and
 * a `UNKNOWN_STATUS` warning is recorded.
 */
export type BillingState = {
  plan: BillingPlanCode;
  subscriptionStatus: StripeSubscriptionStatus | null;
  orgStatus: OrgStatus;
  priceId: string | null;
  billingCycle: BillingCycle | null;
  warnings: ReadonlyArray<BillingStateWarning>;
};

export function resolveBillingState(input: {
  subscription: Stripe.Subscription;
  config: StripeConfig;
}): BillingState {
  const { subscription, config } = input;
  const warnings: BillingStateWarning[] = [];

  const firstItem = subscription.items.data[0];
  const priceId = firstItem?.price?.id ?? null;
  const hasItems = subscription.items.data.length > 0;

  const plan: BillingPlanCode = !hasItems
    ? "FREE"
    : resolvePlanFromPrice(priceId, config, warnings);

  const billingCycle: BillingCycle | null =
    priceId == null ? null : resolveBillingCycle(priceId, config);

  const subscriptionStatus = mapStripeStatus(subscription.status, warnings);
  const orgStatus = subscriptionStatus
    ? mapToOrgStatus(subscriptionStatus)
    : "INCOMPLETE";

  return {
    plan,
    subscriptionStatus,
    orgStatus,
    priceId,
    billingCycle,
    warnings,
  };
}

function resolvePlanFromPrice(
  priceId: string | null,
  config: StripeConfig,
  warnings: BillingStateWarning[],
): BillingPlanCode {
  if (priceId == null) return "CAMPUS";
  if (
    priceId === config.carLinePriceId ||
    priceId === config.carLineAnnualPriceId
  ) {
    return "CAR_LINE";
  }
  if (
    priceId === config.campusPriceId ||
    priceId === config.campusAnnualPriceId
  ) {
    return "CAMPUS";
  }
  warnings.push({ code: "UNKNOWN_PRICE", priceId });
  return "CAMPUS";
}

function resolveBillingCycle(
  priceId: string,
  config: StripeConfig,
): BillingCycle | null {
  if (
    priceId === config.carLineAnnualPriceId ||
    priceId === config.campusAnnualPriceId
  ) {
    return "annual";
  }
  if (
    priceId === config.carLinePriceId ||
    priceId === config.campusPriceId
  ) {
    return "monthly";
  }
  return null;
}

function mapStripeStatus(
  status: string,
  warnings: BillingStateWarning[],
): StripeSubscriptionStatus | null {
  switch (status) {
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
      warnings.push({ code: "UNKNOWN_STATUS", raw: status });
      return null;
  }
}

function mapToOrgStatus(s: StripeSubscriptionStatus): OrgStatus {
  switch (s) {
    case "ACTIVE":
      return "ACTIVE";
    case "TRIALING":
      return "TRIALING";
    case "PAST_DUE":
      return "PAST_DUE";
    case "INCOMPLETE":
    case "INCOMPLETE_EXPIRED":
    case "UNPAID":
      return "INCOMPLETE";
    case "CANCELED":
      return "CANCELED";
  }
}

// ---------------------------------------------------------------------------
// reconcileOrgStatus — merges Stripe-derived state with the persisted org row.
// ---------------------------------------------------------------------------

export type OrgRowFloor = {
  status: OrgStatus;
  trialEndsAt: Date | null;
  pastDueSinceAt: Date | null;
};

export type ReconciledStatus = {
  status: OrgStatus;
  pastDueSinceAt: Date | null;
};

/**
 * Compose the Stripe-derived `BillingState` with persisted org floors:
 *  - **Trial-floor rescue**: if Stripe reports incomplete or unknown but the
 *    org has a valid trial window, keep TRIALING (avoids demoting an active
 *    trial to "Billing Action Required" during a paid-plan onboarding race).
 *  - **SUSPENDED stickiness**: a SUSPENDED org stays SUSPENDED on past_due
 *    webhooks; only ACTIVE/TRIALING/CANCELED can move it.
 *  - **pastDueSinceAt** is stamped on the first past_due transition and
 *    cleared on any non-past_due status.
 *
 * Pure: callers persist the returned shape themselves.
 */
export function reconcileOrgStatus(input: {
  orgRow: OrgRowFloor;
  billingState: BillingState;
  now: Date;
}): ReconciledStatus {
  const { orgRow, billingState, now } = input;
  const sub = billingState.subscriptionStatus;

  // SUSPENDED stickiness on past_due.
  if (sub === "PAST_DUE") {
    if (orgRow.status === "SUSPENDED") {
      return {
        status: "SUSPENDED",
        pastDueSinceAt: orgRow.pastDueSinceAt ?? now,
      };
    }
    return {
      status: "PAST_DUE",
      pastDueSinceAt: orgRow.pastDueSinceAt ?? now,
    };
  }

  // Active or trialing — clear past_due stamp.
  if (sub === "ACTIVE" || sub === "TRIALING") {
    return { status: billingState.orgStatus, pastDueSinceAt: null };
  }

  // Trial-floor rescue: incomplete or unknown + org has a live trial window.
  const hasActiveTrial =
    !!orgRow.trialEndsAt && orgRow.trialEndsAt.getTime() > now.getTime();
  if ((sub === "INCOMPLETE" || sub === null) && hasActiveTrial) {
    return { status: "TRIALING", pastDueSinceAt: null };
  }

  // Everything else (canceled, incomplete-without-trial, expired, unpaid) →
  // map straight through.
  return { status: billingState.orgStatus, pastDueSinceAt: null };
}
