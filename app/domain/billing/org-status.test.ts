import test from "node:test";
import assert from "node:assert/strict";
import {
  isOrgStatusAllowedForApp,
  mapStripeSubscriptionStatusToOrgStatus,
} from "./org-status";

test("allows active-like org statuses", () => {
  assert.equal(isOrgStatusAllowedForApp("ACTIVE"), true);
  assert.equal(isOrgStatusAllowedForApp("TRIALING"), true);
  assert.equal(isOrgStatusAllowedForApp("PAST_DUE"), true);
});

test("blocks non-active org statuses", () => {
  assert.equal(isOrgStatusAllowedForApp("INCOMPLETE"), false);
  assert.equal(isOrgStatusAllowedForApp("CANCELED"), false);
});

test("maps Stripe statuses into org gates", () => {
  assert.equal(mapStripeSubscriptionStatusToOrgStatus("active"), "ACTIVE");
  assert.equal(mapStripeSubscriptionStatusToOrgStatus("past_due"), "PAST_DUE");
  assert.equal(mapStripeSubscriptionStatusToOrgStatus("incomplete"), "INCOMPLETE");
  assert.equal(mapStripeSubscriptionStatusToOrgStatus("canceled"), "CANCELED");
});

