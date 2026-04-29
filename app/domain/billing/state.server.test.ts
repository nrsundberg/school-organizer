import test from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import {
  reconcileOrgStatus,
  resolveBillingState,
  type BillingState,
} from "./state.server";
import type { StripeConfig } from "./stripe.server";

const FIXED_NOW = new Date("2026-04-29T12:00:00Z");
const FUTURE = new Date("2026-06-01T00:00:00Z");
const PAST = new Date("2026-04-01T00:00:00Z");

function buildConfig(overrides: Partial<StripeConfig> = {}): StripeConfig {
  return {
    client: {} as Stripe,
    carLinePriceId: "price_carline_monthly",
    carLineAnnualPriceId: "price_carline_annual",
    campusPriceId: "price_campus_monthly",
    campusAnnualPriceId: "price_campus_annual",
    webhookSecret: "whsec_test",
    ...overrides,
  };
}

function buildSubscription(
  overrides: Partial<Stripe.Subscription> & {
    priceId?: string;
    items?: Stripe.Subscription["items"];
  } = {},
): Stripe.Subscription {
  const priceId = overrides.priceId ?? "price_carline_monthly";
  const defaultItems = {
    data: [
      {
        price: { id: priceId } as Stripe.Price,
      } as Stripe.SubscriptionItem,
    ],
  } as unknown as Stripe.Subscription["items"];
  return {
    id: "sub_test",
    status: "active",
    items: overrides.items ?? defaultItems,
    customer: "cus_test",
    metadata: {},
    ...overrides,
  } as Stripe.Subscription;
}

// ---------------------------------------------------------------------------
// resolveBillingState
// ---------------------------------------------------------------------------

test("resolveBillingState: active CAR_LINE monthly subscription", () => {
  const state = resolveBillingState({
    subscription: buildSubscription({
      status: "active",
      priceId: "price_carline_monthly",
    }),
    config: buildConfig(),
  });
  assert.equal(state.plan, "CAR_LINE");
  assert.equal(state.subscriptionStatus, "ACTIVE");
  assert.equal(state.orgStatus, "ACTIVE");
  assert.equal(state.priceId, "price_carline_monthly");
  assert.equal(state.billingCycle, "monthly");
  assert.deepEqual(state.warnings, []);
});

test("resolveBillingState: trialing CAMPUS annual subscription", () => {
  const state = resolveBillingState({
    subscription: buildSubscription({
      status: "trialing",
      priceId: "price_campus_annual",
    }),
    config: buildConfig(),
  });
  assert.equal(state.plan, "CAMPUS");
  assert.equal(state.subscriptionStatus, "TRIALING");
  assert.equal(state.orgStatus, "TRIALING");
  assert.equal(state.billingCycle, "annual");
});

test("resolveBillingState: past_due maps to PAST_DUE", () => {
  const state = resolveBillingState({
    subscription: buildSubscription({ status: "past_due" }),
    config: buildConfig(),
  });
  assert.equal(state.subscriptionStatus, "PAST_DUE");
  assert.equal(state.orgStatus, "PAST_DUE");
});

test("resolveBillingState: canceled maps to CANCELED", () => {
  const state = resolveBillingState({
    subscription: buildSubscription({ status: "canceled" }),
    config: buildConfig(),
  });
  assert.equal(state.subscriptionStatus, "CANCELED");
  assert.equal(state.orgStatus, "CANCELED");
});

test("resolveBillingState: unknown price emits warning, defaults to CAMPUS", () => {
  const state = resolveBillingState({
    subscription: buildSubscription({ priceId: "price_unknown_xyz" }),
    config: buildConfig(),
  });
  assert.equal(state.plan, "CAMPUS");
  const warnings = state.warnings.filter((w) => w.code === "UNKNOWN_PRICE");
  assert.equal(warnings.length, 1);
  assert.equal((warnings[0] as { priceId: string }).priceId, "price_unknown_xyz");
});

test("resolveBillingState: subscription with no line items maps to FREE", () => {
  const state = resolveBillingState({
    subscription: buildSubscription({
      items: { data: [] } as unknown as Stripe.Subscription["items"],
    }),
    config: buildConfig(),
  });
  assert.equal(state.plan, "FREE");
  assert.equal(state.priceId, null);
  assert.equal(state.billingCycle, null);
});

test("resolveBillingState: unknown subscription status falls back to INCOMPLETE", () => {
  const state = resolveBillingState({
    subscription: buildSubscription({
      status: "future_unknown" as Stripe.Subscription.Status,
    }),
    config: buildConfig(),
  });
  assert.equal(state.subscriptionStatus, null);
  assert.equal(state.orgStatus, "INCOMPLETE");
  const warnings = state.warnings.filter((w) => w.code === "UNKNOWN_STATUS");
  assert.equal(warnings.length, 1);
});

// ---------------------------------------------------------------------------
// reconcileOrgStatus
// ---------------------------------------------------------------------------

const baseBillingState = (overrides: Partial<BillingState> = {}): BillingState => ({
  plan: "CAR_LINE",
  subscriptionStatus: "ACTIVE",
  orgStatus: "ACTIVE",
  priceId: "price_carline_monthly",
  billingCycle: "monthly",
  warnings: [],
  ...overrides,
});

test("reconcileOrgStatus: past_due stamps pastDueSinceAt when not yet stamped", () => {
  const next = reconcileOrgStatus({
    orgRow: { status: "ACTIVE", trialEndsAt: null, pastDueSinceAt: null },
    billingState: baseBillingState({ subscriptionStatus: "PAST_DUE", orgStatus: "PAST_DUE" }),
    now: FIXED_NOW,
  });
  assert.equal(next.status, "PAST_DUE");
  assert.ok(next.pastDueSinceAt);
  assert.equal(next.pastDueSinceAt.getTime(), FIXED_NOW.getTime());
});

test("reconcileOrgStatus: past_due preserves an existing pastDueSinceAt", () => {
  const earlier = new Date("2026-04-15T00:00:00Z");
  const next = reconcileOrgStatus({
    orgRow: { status: "PAST_DUE", trialEndsAt: null, pastDueSinceAt: earlier },
    billingState: baseBillingState({ subscriptionStatus: "PAST_DUE", orgStatus: "PAST_DUE" }),
    now: FIXED_NOW,
  });
  assert.equal(next.pastDueSinceAt?.getTime(), earlier.getTime());
});

test("reconcileOrgStatus: SUSPENDED is sticky across past_due webhooks", () => {
  const earlier = new Date("2026-04-15T00:00:00Z");
  const next = reconcileOrgStatus({
    orgRow: { status: "SUSPENDED", trialEndsAt: null, pastDueSinceAt: earlier },
    billingState: baseBillingState({ subscriptionStatus: "PAST_DUE", orgStatus: "PAST_DUE" }),
    now: FIXED_NOW,
  });
  assert.equal(next.status, "SUSPENDED");
});

test("reconcileOrgStatus: active subscription clears pastDueSinceAt", () => {
  const earlier = new Date("2026-04-15T00:00:00Z");
  const next = reconcileOrgStatus({
    orgRow: { status: "PAST_DUE", trialEndsAt: null, pastDueSinceAt: earlier },
    billingState: baseBillingState({ subscriptionStatus: "ACTIVE", orgStatus: "ACTIVE" }),
    now: FIXED_NOW,
  });
  assert.equal(next.status, "ACTIVE");
  assert.equal(next.pastDueSinceAt, null);
});

test("reconcileOrgStatus: incomplete + active trial keeps TRIALING (trial-floor rescue)", () => {
  const next = reconcileOrgStatus({
    orgRow: { status: "TRIALING", trialEndsAt: FUTURE, pastDueSinceAt: null },
    billingState: baseBillingState({
      subscriptionStatus: "INCOMPLETE",
      orgStatus: "INCOMPLETE",
    }),
    now: FIXED_NOW,
  });
  assert.equal(next.status, "TRIALING");
});

test("reconcileOrgStatus: unknown status + active trial keeps TRIALING (rescue)", () => {
  const next = reconcileOrgStatus({
    orgRow: { status: "TRIALING", trialEndsAt: FUTURE, pastDueSinceAt: null },
    billingState: baseBillingState({
      subscriptionStatus: null,
      orgStatus: "INCOMPLETE",
    }),
    now: FIXED_NOW,
  });
  assert.equal(next.status, "TRIALING");
});

test("reconcileOrgStatus: incomplete + expired trial → INCOMPLETE", () => {
  const next = reconcileOrgStatus({
    orgRow: { status: "TRIALING", trialEndsAt: PAST, pastDueSinceAt: null },
    billingState: baseBillingState({
      subscriptionStatus: "INCOMPLETE",
      orgStatus: "INCOMPLETE",
    }),
    now: FIXED_NOW,
  });
  assert.equal(next.status, "INCOMPLETE");
});

test("reconcileOrgStatus: canceled wins over trial-floor rescue", () => {
  const next = reconcileOrgStatus({
    orgRow: { status: "TRIALING", trialEndsAt: FUTURE, pastDueSinceAt: null },
    billingState: baseBillingState({
      subscriptionStatus: "CANCELED",
      orgStatus: "CANCELED",
    }),
    now: FIXED_NOW,
  });
  assert.equal(next.status, "CANCELED");
});
