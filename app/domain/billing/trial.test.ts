/**
 * Unit tests for evaluateTrial() — pure function, no DB.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTrial } from "./trial.server";

const NOW = new Date("2026-04-20T12:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 86_400_000);
}

test("FREE, 10 days elapsed, 0 pickup days → active", () => {
  const result = evaluateTrial({
    billingPlan: "FREE",
    trialStartedAt: daysAgo(10),
    now: NOW,
    pickupDaysUsed: 0,
    compedUntil: null,
  });
  assert.equal(result.isActive, true);
  assert.equal(result.reason, "active");
  assert.equal(result.daysElapsed, 10);
  assert.equal(result.pickupDaysUsed, 0);
});

test("FREE, 35 days elapsed, 10 pickup days → active (25-pickup-day threshold not met)", () => {
  const result = evaluateTrial({
    billingPlan: "FREE",
    trialStartedAt: daysAgo(35),
    now: NOW,
    pickupDaysUsed: 10,
    compedUntil: null,
  });
  assert.equal(result.isActive, true);
  assert.equal(result.reason, "active");
});

test("FREE, 10 days elapsed, 30 pickup days → active (30-day threshold not met)", () => {
  const result = evaluateTrial({
    billingPlan: "FREE",
    trialStartedAt: daysAgo(10),
    now: NOW,
    pickupDaysUsed: 30,
    compedUntil: null,
  });
  assert.equal(result.isActive, true);
  assert.equal(result.reason, "active");
});

test("FREE, 31 days elapsed, 25 pickup days → expired", () => {
  const result = evaluateTrial({
    billingPlan: "FREE",
    trialStartedAt: daysAgo(31),
    now: NOW,
    pickupDaysUsed: 25,
    compedUntil: null,
  });
  assert.equal(result.isActive, false);
  assert.equal(result.reason, "expired");
});

test("FREE, 31 days elapsed, 25 pickup days, comped for 7 more days → active (comped bypass)", () => {
  const result = evaluateTrial({
    billingPlan: "FREE",
    trialStartedAt: daysAgo(31),
    now: NOW,
    pickupDaysUsed: 25,
    compedUntil: daysFromNow(7),
  });
  assert.equal(result.isActive, true);
  assert.equal(result.reason, "comped");
});

test("CAR_LINE, any values → not_on_trial (bypass)", () => {
  const result = evaluateTrial({
    billingPlan: "CAR_LINE",
    trialStartedAt: daysAgo(100),
    now: NOW,
    pickupDaysUsed: 999,
    compedUntil: null,
  });
  assert.equal(result.isActive, true);
  assert.equal(result.reason, "not_on_trial");
});

test("No trialStartedAt (FREE) → not_on_trial (trial has not begun)", () => {
  // When trialStartedAt is null, we treat the org as not having started a trial.
  // Enforcement does not block — it is treated as if there's no trial context.
  const result = evaluateTrial({
    billingPlan: "FREE",
    trialStartedAt: null,
    now: NOW,
    pickupDaysUsed: 0,
    compedUntil: null,
  });
  assert.equal(result.isActive, true);
  assert.equal(result.reason, "not_on_trial");
});
