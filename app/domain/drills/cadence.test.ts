import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCadenceStatus } from "./cadence";

const NOW = new Date("2026-04-27T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY);
}

describe("computeCadenceStatus", () => {
  it("returns state=none when requiredPerYear is null/undefined", () => {
    assert.deepEqual(computeCadenceStatus(null, daysAgo(10), NOW), { state: "none" });
    assert.deepEqual(computeCadenceStatus(undefined, daysAgo(10), NOW), { state: "none" });
  });

  it("returns state=none for zero or negative cadence", () => {
    assert.deepEqual(computeCadenceStatus(0, daysAgo(10), NOW), { state: "none" });
    assert.deepEqual(computeCadenceStatus(-3, daysAgo(10), NOW), { state: "none" });
  });

  it("returns state=none for non-finite cadence", () => {
    assert.deepEqual(computeCadenceStatus(Number.NaN, daysAgo(10), NOW), { state: "none" });
    assert.deepEqual(computeCadenceStatus(Number.POSITIVE_INFINITY, daysAgo(10), NOW), {
      state: "none",
    });
  });

  it("treats no prior ENDED run as overdue with days=0", () => {
    assert.deepEqual(computeCadenceStatus(12, null, NOW), { state: "overdue", days: 0 });
  });

  it("monthly fire drill (12/yr ≈ 30.4d) within window → due, days remaining floored", () => {
    // 10 days since last → ~20 days remaining
    const status = computeCadenceStatus(12, daysAgo(10), NOW);
    assert.equal(status.state, "due");
    // floor((365/12 - 10) days) = floor(20.4166) = 20
    assert.equal(status.days, 20);
  });

  it("monthly fire drill at the boundary (exactly 365/12 days) → overdue with days=0", () => {
    const last = new Date(NOW.getTime() - (365 / 12) * DAY);
    const status = computeCadenceStatus(12, last, NOW);
    assert.equal(status.state, "overdue");
    assert.equal(status.days, 0);
  });

  it("monthly fire drill 5 days past window → overdue with days≈5", () => {
    // 365/12 ≈ 30.4166; +5 days late = 35.4166 days since last
    const last = new Date(NOW.getTime() - ((365 / 12) + 5) * DAY);
    const status = computeCadenceStatus(12, last, NOW);
    assert.equal(status.state, "overdue");
    // ceil(5.0) = 5
    assert.equal(status.days, 5);
  });

  it("quarterly lockdown drill (4/yr ≈ 91.25d) within window", () => {
    const status = computeCadenceStatus(4, daysAgo(30), NOW);
    assert.equal(status.state, "due");
    // floor(91.25 - 30) = 61
    assert.equal(status.days, 61);
  });

  it("annual drill (1/yr = 365d): 100 days ago → due with 264 days remaining", () => {
    const status = computeCadenceStatus(1, daysAgo(100), NOW);
    assert.equal(status.state, "due");
    assert.equal(status.days, 265);
  });

  it("annual drill (1/yr = 365d): 400 days ago → overdue with 35 days past due", () => {
    const status = computeCadenceStatus(1, daysAgo(400), NOW);
    assert.equal(status.state, "overdue");
    assert.equal(status.days, 35);
  });

  it("rounds up partial overdue days (0.4 days over → 1d overdue)", () => {
    // 365/12 + 0.4 days since last
    const last = new Date(NOW.getTime() - ((365 / 12) + 0.4) * DAY);
    const status = computeCadenceStatus(12, last, NOW);
    assert.equal(status.state, "overdue");
    assert.equal(status.days, 1);
  });

  it("never returns negative days", () => {
    // Last run in the future (clock skew defensive guard)
    const last = new Date(NOW.getTime() + 10 * DAY);
    const status = computeCadenceStatus(12, last, NOW);
    assert.equal(status.state, "due");
    assert.ok((status.days ?? -1) >= 0);
  });
});
