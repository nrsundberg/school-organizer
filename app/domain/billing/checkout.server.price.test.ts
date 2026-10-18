import assert from "node:assert/strict";
import test from "node:test";

import { priceIdForPlan } from "./checkout.server";
import type { StripeConfig } from "./stripe.server";

function config(overrides: Partial<StripeConfig> = {}): StripeConfig {
  return {
    client: {} as StripeConfig["client"],
    carLinePriceId: "price_car_line_month",
    carLineAnnualPriceId: "price_car_line_year",
    campusPriceId: "price_campus_month",
    campusAnnualPriceId: "price_campus_year",
    webhookSecret: "whsec_test",
    ...overrides,
  };
}

test("priceIdForPlan returns the monthly or annual price for each plan", () => {
  const cfg = config();
  assert.equal(priceIdForPlan(cfg, "CAR_LINE", "monthly"), "price_car_line_month");
  assert.equal(priceIdForPlan(cfg, "CAR_LINE", "annual"), "price_car_line_year");
  assert.equal(priceIdForPlan(cfg, "CAMPUS", "monthly"), "price_campus_month");
  assert.equal(priceIdForPlan(cfg, "CAMPUS", "annual"), "price_campus_year");
});

test("priceIdForPlan refuses to charge monthly when annual is selected but unset", () => {
  const cfg = config({
    carLineAnnualPriceId: null,
    campusAnnualPriceId: null,
  });
  assert.throws(
    () => priceIdForPlan(cfg, "CAR_LINE", "annual"),
    /STRIPE_CAR_LINE_ANNUAL_PRICE_ID/,
  );
  assert.throws(
    () => priceIdForPlan(cfg, "CAMPUS", "annual"),
    /STRIPE_CAMPUS_ANNUAL_PRICE_ID/,
  );
  assert.equal(priceIdForPlan(cfg, "CAR_LINE", "monthly"), "price_car_line_month");
  assert.equal(priceIdForPlan(cfg, "CAMPUS", "monthly"), "price_campus_month");
});
