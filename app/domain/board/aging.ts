// Yellow→green aging for pickup-board tiles. A called space shows "fresh"
// (yellow) for the first TIMEOUT_MS, then "waiting" (green) as a staleness cue.
//
// `isTimedOut` is pure and takes `now` explicitly so callers can drive it from
// a single shared clock (see `~/hooks/useAgingClock`) and so it's deterministic
// to unit-test. It must NOT read the wall clock itself.

export const TIMEOUT_MS = 30000;

export function isTimedOut(
  timestamp: string | null | undefined,
  now: number,
): boolean {
  if (!timestamp) return false;
  return now - new Date(timestamp).getTime() > TIMEOUT_MS;
}
