import { useCallback, useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

type DrillUpdateMsg = {
  type: "drillUpdate";
  run: {
    id: string;
    status: "LIVE" | "PAUSED" | "ENDED";
    audience: string;
    state: unknown; // RunState JSON — consumer parses
    updatedAtIso: string;
  };
};

type DrillActivityMsg = {
  type: "drillActivity";
  runId: string;
  events: Array<{
    id: string;
    runId: string;
    kind: string;
    payload: unknown;
    actorUserId: string | null;
    actorLabel: string | null;
    occurredAtIso: string;
  }>;
};

type DrillPresenceMsg = {
  type: "drillPresence";
  runId: string;
  userId: string;
  label: string;
  color: string;
  focus:
    | { kind: "notes" }
    | { kind: "item"; id: string }
    | null;
  at: string;
};

type DrillEndedMsg = { type: "drillEnded"; runId: string };

export function useDrillWebSocket({
  runId,
  onUpdate,
  onActivity,
  onPresence,
  onEnded,
}: {
  runId: string;
  onUpdate?: (msg: DrillUpdateMsg) => void;
  onActivity?: (msg: DrillActivityMsg) => void;
  onPresence?: (msg: DrillPresenceMsg) => void;
  onEnded?: (msg: DrillEndedMsg) => void;
}): {
  send: (data: unknown) => void;
} {
  const revalidator = useRevalidator();
  const reconnectDelay = useRef(1000);
  const wsRef = useRef<WebSocket | null>(null);

  const runIdRef = useRef(runId);
  const onUpdateRef = useRef(onUpdate);
  const onActivityRef = useRef(onActivity);
  const onPresenceRef = useRef(onPresence);
  const onEndedRef = useRef(onEnded);
  runIdRef.current = runId;
  onUpdateRef.current = onUpdate;
  onActivityRef.current = onActivity;
  onPresenceRef.current = onPresence;
  onEndedRef.current = onEnded;

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch {
        // Silently ignore serialization or send errors — presence is ephemeral.
      }
    }
  }, []);

  useEffect(() => {
    let unmounted = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (unmounted) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelay.current = 1000;
      };

      ws.onmessage = (event) => {
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          // Non-JSON message (e.g., "pong") — ignore.
          return;
        }

        if (!data || typeof data !== "object") return;
        const msg = data as { type?: unknown };
        if (typeof msg.type !== "string") return;

        const currentRunId = runIdRef.current;

        switch (msg.type) {
          case "drillUpdate": {
            const m = data as DrillUpdateMsg;
            if (m.run?.id !== currentRunId) return;
            onUpdateRef.current?.(m);
            return;
          }
          case "drillActivity": {
            const m = data as DrillActivityMsg;
            if (m.runId !== currentRunId) return;
            onActivityRef.current?.(m);
            return;
          }
          case "drillPresence": {
            const m = data as DrillPresenceMsg;
            if (m.runId !== currentRunId) return;
            onPresenceRef.current?.(m);
            return;
          }
          case "drillEnded": {
            const m = data as DrillEndedMsg;
            if (m.runId !== currentRunId) return;
            onEndedRef.current?.(m);
            return;
          }
          default:
            // Unknown / non-drill message types (e.g. bingo's spaceUpdate,
            // callEvent) — ignore silently. The connection may be shared.
            return;
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        // Revalidate to catch up via the loader, then reconnect with backoff.
        revalidator.revalidate();
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, 30000);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { send };
}
