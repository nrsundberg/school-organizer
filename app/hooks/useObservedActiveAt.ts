import { useRef } from "react";

/**
 * Returns the device-local time (ms, from `Date.now()`) at which THIS client
 * first observed the current active episode of a space — or null when the space
 * isn't active. Board tile aging is measured as `now - observedAt` using the
 * device clock for both ends (see `~/domain/board/aging`), which is what makes
 * it immune to the display's wall clock being wrong.
 *
 * Re-anchors when `timestamp` changes (the space was marked active again), so a
 * re-called space restarts its yellow window. On an always-on, continuously
 * connected display this records the call the instant the WebSocket delivers it,
 * so the anchor matches the real call time; only a full page reload resets the
 * anchor to load time (acceptable — reloads are rare and we can't trust the
 * device clock to reconstruct the true age anyway).
 */
export function useObservedActiveAt(
  isActive: boolean,
  timestamp: string | null,
): number | null {
  // Ref-as-cache: mutated during render but idempotently (only when the active
  // episode actually changes), so it's safe under StrictMode double-invoke.
  const ref = useRef<{ key: string | null; at: number } | null>(null);

  if (isActive) {
    if (!ref.current || ref.current.key !== timestamp) {
      ref.current = { key: timestamp, at: Date.now() };
    }
  } else if (ref.current) {
    ref.current = null;
  }

  return ref.current?.at ?? null;
}
