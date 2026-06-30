import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasAged, TIMEOUT_MS } from "./aging";

const NOW = new Date("2026-04-27T12:00:00Z").getTime();

describe("hasAged", () => {
  it("is false with no anchor (not active)", () => {
    assert.equal(hasAged(null, NOW), false);
  });

  it("is false while still fresh (<= TIMEOUT_MS)", () => {
    assert.equal(hasAged(NOW, NOW), false);
    assert.equal(hasAged(NOW - (TIMEOUT_MS - 1), NOW), false);
    assert.equal(hasAged(NOW - TIMEOUT_MS, NOW), false); // boundary: not yet >
  });

  it("is true once observed longer than TIMEOUT_MS ago", () => {
    assert.equal(hasAged(NOW - (TIMEOUT_MS + 1), NOW), true);
    assert.equal(hasAged(NOW - 5 * 60 * 1000, NOW), true);
  });

  it("uses one clock for both ends, so a skewed device clock is irrelevant", () => {
    // Anchor + now both sampled from the same (wrong) device clock 40s apart.
    const wrongNow = NOW + 9_999_999; // device clock is way off vs real time
    assert.equal(hasAged(wrongNow - 40_000, wrongNow), true);
    assert.equal(hasAged(wrongNow - 10_000, wrongNow), false);
  });
});
