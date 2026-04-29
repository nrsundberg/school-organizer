import test from "node:test";
import assert from "node:assert/strict";
import {
  isOrgAccessAllowed,
  mapStripeSubscriptionStatusToOrgStatus,
} from "./org-status";

const NOW = new Date("2026-04-29T12:00:00Z");
const FUTURE = new Date("2026-05-15T00:00:00Z");
const PAST = new Date("2026-04-01T00:00:00Z");

const standaloneOrg = (overrides: Partial<Parameters<typeof isOrgAccessAllowed>[0]["org"]> = {}) => ({
  status: "ACTIVE" as const,
  compedUntil: null,
  isComped: false,
  districtId: null,
  ...overrides,
});

const district = (overrides: Partial<NonNullable<Parameters<typeof isOrgAccessAllowed>[0]["district"]>> = {}) => ({
  status: "ACTIVE" as const,
  compedUntil: null,
  isComped: false,
  ...overrides,
});

test("standalone org: ACTIVE without comp is allowed", () => {
  assert.equal(isOrgAccessAllowed({ org: standaloneOrg({ status: "ACTIVE" }) }, NOW), true);
});

test("standalone org: TRIALING and PAST_DUE are allowed (current allow-set)", () => {
  assert.equal(isOrgAccessAllowed({ org: standaloneOrg({ status: "TRIALING" }) }, NOW), true);
  assert.equal(isOrgAccessAllowed({ org: standaloneOrg({ status: "PAST_DUE" }) }, NOW), true);
});

test("standalone org: SUSPENDED without comp is denied", () => {
  assert.equal(isOrgAccessAllowed({ org: standaloneOrg({ status: "SUSPENDED" }) }, NOW), false);
});

test("standalone org: isComped flag overrides any blocking status", () => {
  assert.equal(isOrgAccessAllowed({ org: standaloneOrg({ status: "CANCELED", isComped: true }) }, NOW), true);
  assert.equal(isOrgAccessAllowed({ org: standaloneOrg({ status: "SUSPENDED", isComped: true }) }, NOW), true);
});

test("standalone org: compedUntil in the future allows otherwise-blocked status", () => {
  assert.equal(
    isOrgAccessAllowed({ org: standaloneOrg({ status: "SUSPENDED", compedUntil: FUTURE }) }, NOW),
    true,
  );
});

test("standalone org: compedUntil in the past does not allow blocked status", () => {
  assert.equal(
    isOrgAccessAllowed({ org: standaloneOrg({ status: "SUSPENDED", compedUntil: PAST }) }, NOW),
    false,
  );
});

test("district-attached org: district ACTIVE allows access regardless of org status", () => {
  // Org's own billing fields are unused for district-attached orgs.
  assert.equal(
    isOrgAccessAllowed(
      {
        org: standaloneOrg({ status: "SUSPENDED", districtId: "dist_1" }),
        district: district({ status: "ACTIVE" }),
      },
      NOW,
    ),
    true,
  );
});

test("district-attached org: district SUSPENDED denies access regardless of org status", () => {
  assert.equal(
    isOrgAccessAllowed(
      {
        org: standaloneOrg({ status: "ACTIVE", districtId: "dist_1" }),
        district: district({ status: "SUSPENDED" }),
      },
      NOW,
    ),
    false,
  );
});

test("district-attached org: district isComped allows even when district status is blocked", () => {
  assert.equal(
    isOrgAccessAllowed(
      {
        org: standaloneOrg({ status: "ACTIVE", districtId: "dist_1" }),
        district: district({ status: "CANCELED", isComped: true }),
      },
      NOW,
    ),
    true,
  );
});

test("district-attached org: org-level isComped does NOT bypass a blocked district", () => {
  assert.equal(
    isOrgAccessAllowed(
      {
        org: standaloneOrg({ status: "ACTIVE", districtId: "dist_1", isComped: true }),
        district: district({ status: "SUSPENDED" }),
      },
      NOW,
    ),
    false,
  );
});

test("district-attached org: missing district payload throws (caller bug)", () => {
  assert.throws(() =>
    isOrgAccessAllowed({ org: standaloneOrg({ districtId: "dist_1" }) }, NOW),
  );
});

test("maps Stripe statuses into org gates", () => {
  assert.equal(mapStripeSubscriptionStatusToOrgStatus("active"), "ACTIVE");
  assert.equal(mapStripeSubscriptionStatusToOrgStatus("past_due"), "PAST_DUE");
  assert.equal(mapStripeSubscriptionStatusToOrgStatus("incomplete"), "INCOMPLETE");
  assert.equal(mapStripeSubscriptionStatusToOrgStatus("canceled"), "CANCELED");
});
