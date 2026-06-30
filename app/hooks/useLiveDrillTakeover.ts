import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

/**
 * Global "a drill just started" listener, mounted once at the root so EVERY
 * open page — not just `/drills/live` — reacts the instant an admin starts a
 * live drill.
 *
 * On a `{ type: "drillStarted" }` broadcast it calls `revalidator.revalidate()`.
 * That re-runs the root loader, whose existing takeover logic
 * (`getActiveDrillAudience` + `liveDrillRedirectTarget`) decides per-client
 * whether to `throw redirect("/drills/live")`. All audience rules stay on the
 * server — this hook intentionally knows nothing about who is in-audience.
 *
 * The connection is the same shared per-tenant `/ws` Durable Object used by
 * the bingo board and the live drill page, so every other message type is
 * ignored here.
 */
export function useLiveDrillTakeover({
  enabled = true,
}: { enabled?: boolean } = {}): void {
  const revalidator = useRevalidator();
  const revalidatorRef = useRef(revalidator);
  revalidatorRef.current = revalidator;

  const reconnectDelay = useRef(1000);

  useEffect(() => {
    if (!enabled) return;

    let unmounted = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;

    function connect() {
      if (unmounted) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => {
        reconnectDelay.current = 1000;
      };

      ws.onmessage = (event) => {
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          // Non-JSON (e.g. "pong") — ignore.
          return;
        }
        if (!data || typeof data !== "object") return;
        if ((data as { type?: unknown }).type !== "drillStarted") return;

        // Re-run the root loader; it redirects in-audience callers into the
        // drill. Skip if a revalidation is already in flight to avoid a storm.
        if (revalidatorRef.current.state === "idle") {
          revalidatorRef.current.revalidate();
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, 30000);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
    };
  }, [enabled]);
}
