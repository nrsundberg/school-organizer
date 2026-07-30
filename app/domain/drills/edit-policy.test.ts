import assert from "node:assert/strict";
import test from "node:test";
import { canEditDrillRun } from "./edit-policy";

test("signed-in staff may write to a live drill", () => {
  assert.equal(canEditDrillRun("STAFF"), true);
});

test("magic-code guests may watch but never write", () => {
  assert.equal(canEditDrillRun("VIEWER_PIN"), false);
});

test("anonymous callers may not write", () => {
  assert.equal(canEditDrillRun("NONE"), false);
});
