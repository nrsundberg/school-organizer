import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePublicPlanSelectionSource,
  pricingPathForPlan,
  signupPathForPlan
} from "./public-plans";

test("plan selection source defaults safely", () => {
  assert.equal(normalizePublicPlanSelectionSource("explicit"), "explicit");
  assert.equal(normalizePublicPlanSelectionSource("DEFAULT"), "default");
  assert.equal(normalizePublicPlanSelectionSource(null), "default");
});

test("public pricing and signup paths preserve plan + cycle", () => {
  assert.equal(
    signupPathForPlan("campus", "annual"),
    "/signup?plan=campus&cycle=annual"
  );
  assert.equal(
    pricingPathForPlan("CAR_LINE", "monthly"),
    "/pricing?plan=car-line&cycle=monthly"
  );
});
