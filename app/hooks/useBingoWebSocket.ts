import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

type SpaceUpdate = {
  type: "spaceUpdate";
  spaceNumber: number;
  status: string;
  timestamp?: string | null;
};

type CallEventUpdate = {
  type: "callEvent";
  event: {
    id: number;
    spaceNumber: number;
    studentId: number | null;
    studentName: string;
    homeRoomSnapshot: string | null;
    createdAt: string;
  };
};

type BoardResetUpdate = {
  type: "boardReset";
};

type ProgramCancellationUpdate = {
  type: "programCancellation";
  cancellation: {
    id: string;
    programName: string;
    cancellationDate: string;
    title: string;
    message: string;
  };
};

export function useBingoWebSocket({
  onSpaceUpdate,
  onCallEvent,
  onBoardReset,
  onProgramCancellation,
}: {
  onSpaceUpdate: (update: SpaceUpdate) => void;
  onCallEvent?: (update: CallEventUpdate) => void;
  onBoardReset?: (update: BoardResetUpdate) => void;
  onProgramCancellation?: (update: ProgramCancellationUpdate) => void;
}) {
  const revalidator = useRevalidator();
  const reconnectDelay = useRef(1000);
  const wsRef = useRef<WebSocket | null>(null);
  const onSpaceUpdateRef = useRef(onSpaceUpdate);
  const onCallEventRef = useRef(onCallEvent);
  const onBoardResetRef = useRef(onBoardReset);
  const onProgramCancellationRef = useRef(onProgramCancellation);
  onSpaceUpdateRef.current = onSpaceUpdate;
  onCallEventRef.current = onCallEvent;
  onBoardResetRef.current = onBoardReset;
  onProgramCancellationRef.current = onProgramCancellation;

  useEffect(() => {
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelay.current = 1000;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "spaceUpdate") {
            onSpaceUpdateRef.current(data);
          } else if (data.type === "callEvent" && onCallEventRef.current) {
            onCallEventRef.current(data);
          } else if (data.type === "boardReset" && onBoardResetRef.current) {
            onBoardResetRef.current(data);
          } else if (data.type === "programCancellation" && onProgramCancellationRef.current) {
            onProgramCancellationRef.current(data);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        // Revalidate to sync state, then reconnect
        revalidator.revalidate();
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, 30000);
        setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      unmounted = true;
      wsRef.current?.close();
    };
  }, []);
}
