import assert from "node:assert/strict";
import test from "node:test";

import {
  ANNUAL_DISCOUNT_PERCENT,
  PUBLIC_PLAN_PRICES,
  STRIPE_PRICE_SPECS,
  annualSavingsDollars,
  publicPriceDisplay,
  undiscountedAnnualDollars,
} from "./public-prices";

test("annual prices are 20% off twelve months of the monthly rate", () => {
  for (const plan of ["CAR_LINE", "CAMPUS"] as const) {
    const monthly = PUBLIC_PLAN_PRICES[plan].monthlyDollars;
    const expectedAnnual = Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100));
    assert.equal(PUBLIC_PLAN_PRICES[plan].annualDollars, expectedAnnual);
    assert.equal(undiscountedAnnualDollars(plan), monthly * 12);
    assert.equal(annualSavingsDollars(plan), monthly * 12 - expectedAnnual);
  }
});

test("published amounts are Car Line $150/$1,440 and Campus $500/$4,800", () => {
  assert.deepEqual(PUBLIC_PLAN_PRICES.CAR_LINE, {
    monthlyDollars: 150,
    annualDollars: 1440,
  });
  assert.deepEqual(PUBLIC_PLAN_PRICES.CAMPUS, {
    monthlyDollars: 500,
    annualDollars: 4800,
  });
  assert.equal(ANNUAL_DISCOUNT_PERCENT, 20);
});

test("pricing page display strings use grouped dollars", () => {
  assert.equal(publicPriceDisplay("CAR_LINE", "monthly").formatted, "150");
  assert.equal(publicPriceDisplay("CAR_LINE", "annual").formatted, "1,440");
  assert.equal(publicPriceDisplay("CAMPUS", "monthly").formatted, "500");
  assert.equal(publicPriceDisplay("CAMPUS", "annual").formatted, "4,800");
  assert.equal(
    publicPriceDisplay("CAR_LINE", "annual").undiscountedAnnualFormatted,
    "1,800",
  );
  assert.equal(
    publicPriceDisplay("CAMPUS", "annual").undiscountedAnnualFormatted,
    "6,000",
  );
  assert.equal(publicPriceDisplay("CAR_LINE", "monthly").annualFormatted, "1,440");
  assert.equal(publicPriceDisplay("CAMPUS", "monthly").savePercent, 20);
});

test("Stripe setup specs match the public amounts and env var names", () => {
  assert.deepEqual(
    STRIPE_PRICE_SPECS.map((spec) => ({
      envVar: spec.envVar,
      interval: spec.interval,
      cents: spec.unitAmountCents,
      lookupKey: spec.lookupKey,
    })),
    [
      {
        envVar: "STRIPE_CAR_LINE_PRICE_ID",
        interval: "month",
        cents: 15000,
        lookupKey: "pickuproster_car_line_monthly",
      },
      {
        envVar: "STRIPE_CAR_LINE_ANNUAL_PRICE_ID",
        interval: "year",
        cents: 144000,
        lookupKey: "pickuproster_car_line_annual",
      },
      {
        envVar: "STRIPE_CAMPUS_PRICE_ID",
        interval: "month",
        cents: 50000,
        lookupKey: "pickuproster_campus_monthly",
      },
      {
        envVar: "STRIPE_CAMPUS_ANNUAL_PRICE_ID",
        interval: "year",
        cents: 480000,
        lookupKey: "pickuproster_campus_annual",
      },
    ],
  );
});
