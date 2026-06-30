import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTimedOut, TIMEOUT_MS } from "./aging";

const NOW = new Date("2026-04-27T12:00:00Z").getTime();
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("isTimedOut", () => {
  it("is false when there is no timestamp", () => {
    assert.equal(isTimedOut(null, NOW), false);
    assert.equal(isTimedOut(undefined, NOW), false);
    assert.equal(isTimedOut("", NOW), false);
  });

  it("is false while still fresh (< TIMEOUT_MS)", () => {
    assert.equal(isTimedOut(at(0), NOW), false);
    assert.equal(isTimedOut(at(TIMEOUT_MS - 1), NOW), false);
    assert.equal(isTimedOut(at(TIMEOUT_MS), NOW), false); // boundary: not yet >
  });

  it("is true once older than TIMEOUT_MS", () => {
    assert.equal(isTimedOut(at(TIMEOUT_MS + 1), NOW), true);
    assert.equal(isTimedOut(at(5 * 60 * 1000), NOW), true);
  });
});
