import test from "node:test";
import assert from "node:assert/strict";
import { isOrgStatusAllowedForApp } from "./org-status";

test("allows active-like org statuses", () => {
  assert.equal(isOrgStatusAllowedForApp("ACTIVE"), true);
  assert.equal(isOrgStatusAllowedForApp("TRIALING"), true);
  assert.equal(isOrgStatusAllowedForApp("PAST_DUE"), true);
});

test("blocks non-active org statuses", () => {
  assert.equal(isOrgStatusAllowedForApp("SUSPENDED"), false);
  assert.equal(isOrgStatusAllowedForApp("INCOMPLETE"), false);
  assert.equal(isOrgStatusAllowedForApp("CANCELED"), false);
});

