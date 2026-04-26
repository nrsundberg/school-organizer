import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertDistrictHasStripeCustomer } from "./checkout.server";

describe("assertDistrictHasStripeCustomer", () => {
  it("throws when stripeCustomerId is null", () => {
    assert.throws(
      () =>
        assertDistrictHasStripeCustomer({
          id: "d1",
          stripeCustomerId: null,
        }),
      /no Stripe customer/i,
    );
  });
  it("throws when stripeCustomerId is empty string", () => {
    assert.throws(
      () =>
        assertDistrictHasStripeCustomer({
          id: "d1",
          stripeCustomerId: "",
        }),
      /no Stripe customer/i,
    );
  });
  it("does not throw when set", () => {
    assert.doesNotThrow(() =>
      assertDistrictHasStripeCustomer({
        id: "d1",
        stripeCustomerId: "cus_xxx",
      }),
    );
  });
});
