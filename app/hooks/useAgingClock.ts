import { useEffect, useState } from "react";

/**
 * A resilient "now" clock for board tile aging (yellow→green). Returns a
 * timestamp that advances:
 *   - on a steady interval while `enabled` (so a continuously-foreground board
 *     ages without any user interaction), and
 *   - immediately whenever the tab regains visibility/focus (`visibilitychange`,
 *     window `focus`, `pageshow`).
 *
 * The second part is the important one: the board's loader sets
 * `shouldRevalidate = () => false` to avoid re-firing D1 queries on focus, and
 * browsers throttle/drop timers on long-lived, occluded, or backgrounded tabs
 * (exactly an always-on wall display). A single one-shot `setTimeout` per tile
 * therefore silently dies and the tile stays "fresh" until a manual refresh.
 * Recomputing on every return-to-foreground is a cheap, D1-free "catch up" that
 * fixes that without touching revalidation.
 *
 * `enabled` should be a boolean (e.g. "any space is ACTIVE") — never an array —
 * so the interval isn't torn down and recreated on every board update.
 */
export function useAgingClock(enabled: boolean, intervalMs = 3000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());

    // Always recover on return-to-foreground, even when not `enabled` at the
    // moment the tab was hidden.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    window.addEventListener("pageshow", tick);

    let id: ReturnType<typeof setInterval> | undefined;
    if (enabled) {
      tick(); // re-sync immediately when aging becomes relevant
      id = setInterval(tick, intervalMs);
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
      window.removeEventListener("pageshow", tick);
      if (id !== undefined) clearInterval(id);
    };
  }, [enabled, intervalMs]);

  return now;
}
