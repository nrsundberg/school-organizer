import assert from "node:assert/strict";
import test from "node:test";
import { addDaysUtc, computeTrialEndsAtUtc, TRIAL_CALENDAR_DAYS, TRIAL_QUALIFYING_DAYS } from "./trial.server";

test("computeTrialEndsAtUtc uses the later of 30d and 25th qualifying day", () => {
  const start = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
  const d30 = addDaysUtc(start, TRIAL_CALENDAR_DAYS);
  const dates: string[] = [];
  for (let i = 0; i < TRIAL_QUALIFYING_DAYS; i++) {
    const d = addDaysUtc(start, i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const end = computeTrialEndsAtUtc(start, dates);
  const t25 = new Date(`${dates[TRIAL_QUALIFYING_DAYS - 1]}T23:59:59.999Z`);
  assert.equal(end.getTime(), Math.max(d30.getTime(), t25.getTime()));
});
