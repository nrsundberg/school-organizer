import {
  TRIAL_CALENDAR_DAYS,
  TRIAL_MIN_STUDENTS_PER_QUALIFYING_DAY,
  TRIAL_QUALIFYING_DAYS,
} from "~/lib/trial-rules";

export {
  TRIAL_CALENDAR_DAYS,
  TRIAL_MIN_STUDENTS_PER_QUALIFYING_DAY,
  TRIAL_QUALIFYING_DAYS,
};

// ---------------------------------------------------------------------------
// Pure trial evaluation — no DB calls.
//
// This is the synchronous gate used by request-time enforcement
// (`trial-enforcement.server.ts`) where the caller has already counted
// pickup-days. The cron-side state machine — which queries CallEvent
// itself — lives in `trial-lifecycle.server.ts`.
// ---------------------------------------------------------------------------

export type TrialStatus = {
  isActive: boolean;
  daysElapsed: number;
  pickupDaysUsed: number;
  reason: "active" | "expired" | "not_on_trial" | "comped";
};

/**
 * Evaluate trial state for an org without touching the database.
 *
 * Rules:
 * - Non-FREE plans → reason: "not_on_trial"
 * - No trialStartedAt → reason: "not_on_trial"  (trial has not begun)
 * - compedUntil > now → reason: "comped"  (active regardless of thresholds)
 * - FREE plan, trial started:
 *   - active if daysElapsed < 30 OR pickupDaysUsed < 25 (whichever ends later)
 *   - expired only when BOTH thresholds are met
 */
export function evaluateTrial(params: {
  billingPlan: "FREE" | "CAR_LINE" | "CAMPUS" | "ENTERPRISE";
  trialStartedAt: Date | null;
  now: Date;
  pickupDaysUsed: number;
  compedUntil: Date | null;
}): TrialStatus {
  const { billingPlan, trialStartedAt, now, pickupDaysUsed, compedUntil } = params;

  if (billingPlan !== "FREE") {
    return { isActive: true, daysElapsed: 0, pickupDaysUsed, reason: "not_on_trial" };
  }

  if (!trialStartedAt) {
    return { isActive: true, daysElapsed: 0, pickupDaysUsed, reason: "not_on_trial" };
  }

  // Comped bypass
  if (compedUntil && compedUntil.getTime() > now.getTime()) {
    const daysElapsed = Math.floor((now.getTime() - trialStartedAt.getTime()) / 86_400_000);
    return { isActive: true, daysElapsed, pickupDaysUsed, reason: "comped" };
  }

  const daysElapsed = Math.floor((now.getTime() - trialStartedAt.getTime()) / 86_400_000);

  // Active if EITHER threshold is not yet met
  const calendarOk = daysElapsed < TRIAL_CALENDAR_DAYS;
  const pickupOk = pickupDaysUsed < TRIAL_QUALIFYING_DAYS;

  if (calendarOk || pickupOk) {
    return { isActive: true, daysElapsed, pickupDaysUsed, reason: "active" };
  }

  return { isActive: false, daysElapsed, pickupDaysUsed, reason: "expired" };
}

export function addDaysUtc(start: Date, days: number): Date {
  const d = new Date(start.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
