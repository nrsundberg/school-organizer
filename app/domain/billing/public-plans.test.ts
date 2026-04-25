import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePublicPlanSelectionSource,
  pricingPathForPlan,
  shouldStartCheckoutAfterSignup,
  signupPathForPlan
} from "./public-plans";

test("self-serve plans only start checkout after an explicit paid selection", () => {
  assert.equal(shouldStartCheckoutAfterSignup("CAR_LINE", "explicit"), true);
  assert.equal(shouldStartCheckoutAfterSignup("CAMPUS", "explicit"), true);
  assert.equal(shouldStartCheckoutAfterSignup("DISTRICT", "explicit"), false);
  assert.equal(shouldStartCheckoutAfterSignup("CAR_LINE", "default"), false);
});

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
