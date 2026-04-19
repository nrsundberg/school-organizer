/**
 * Trial policy numbers shared by UI and server. Keep in sync with billing logic in trial.server.ts.
 */
export const TRIAL_CALENDAR_DAYS = 30;
/** Qualifying “pickup” days required for the trial milestone. */
export const TRIAL_QUALIFYING_DAYS = 25;
/** A qualifying day has more than this many distinct students with call events. */
export const TRIAL_MIN_STUDENTS_PER_QUALIFYING_DAY = 10;
