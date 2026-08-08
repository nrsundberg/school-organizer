// Yellow→green aging for pickup-board tiles. A called space shows "fresh"
// (yellow) for the first TIMEOUT_MS, then "waiting" (green) as a staleness cue.
//
// Aging is measured from a DEVICE-LOCAL anchor — the moment this client first
// observed the space active (see `~/hooks/useObservedActiveAt`) — compared
// against a device-local `now` (see `~/hooks/useAgingClock`). Both ends use the
// same clock, so aging is immune to the display's wall clock being wrong: an
// always-on kiosk/TV without NTP can disagree with the server by minutes, which
// previously made `serverTimestamp` vs `Date.now()` come out negative and left
// tiles stuck yellow forever. `hasAged` stays pure (takes `now`) so it's
// deterministic to unit-test.

export const TIMEOUT_MS = 30000;

export function hasAged(observedAtMs: number | null, now: number): boolean {
  return observedAtMs != null && now - observedAtMs > TIMEOUT_MS;
}
