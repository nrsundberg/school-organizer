import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyEvent } from "./replay";
import type {
  DrillEventKind,
  DrillEventPayload,
  RunState,
} from "./types";

export type ReplayEvent = {
  id: string;
  kind: DrillEventKind;
  payload: DrillEventPayload;
  occurredAt: string;
  actor: { id: string; name: string } | null;
  onBehalfOf: { id: string; name: string } | null;
};

export type ReplaySpeed = 0.5 | 1 | 2 | 4 | 8;

export type UseDrillReplayArgs = {
  initialState: RunState;
  events: ReplayEvent[];
  startedAtIso: string;
  endedAtIso: string;
};

export type UseDrillReplayResult = {
  replayState: RunState;
  currentTimeMs: number;
  totalDurationMs: number;
  currentEventIndex: number;
  isPlaying: boolean;
  speed: ReplaySpeed;
  play: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  setSpeed: (s: ReplaySpeed) => void;
};

/**
 * Index of the LAST event whose offset <= ms. Returns -1 if none.
 * `offsets` must be sorted non-decreasing.
 */
function findEventIndexAt(offsets: number[], ms: number): number {
  if (offsets.length === 0 || ms < offsets[0]) return -1;
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (offsets[mid] <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function useDrillReplay({
  initialState,
  events,
  startedAtIso,
  endedAtIso,
}: UseDrillReplayArgs): UseDrillReplayResult {
  const startMs = useMemo(() => new Date(startedAtIso).getTime(), [startedAtIso]);
  const endMs = useMemo(() => new Date(endedAtIso).getTime(), [endedAtIso]);
  const totalDurationMs = Math.max(0, endMs - startMs);

  // offsets[i] = ms-from-start of events[i]; clamped to [0, totalDurationMs].
  const offsets = useMemo(() => {
    return events.map((e) => {
      const t = new Date(e.occurredAt).getTime() - startMs;
      if (!Number.isFinite(t)) return 0;
      return Math.max(0, Math.min(totalDurationMs, t));
    });
  }, [events, startMs, totalDurationMs]);

  // snapshots[0] = initial; snapshots[i+1] = state after applying events[i].
  const snapshots = useMemo<RunState[]>(() => {
    const out: RunState[] = new Array(events.length + 1);
    out[0] = initialState;
    let cur = initialState;
    for (let i = 0; i < events.length; i++) {
      cur = applyEvent(cur, events[i].payload);
      out[i + 1] = cur;
    }
    return out;
  }, [events, initialState]);

  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState<ReplaySpeed>(1);

  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const speedRef = useRef<ReplaySpeed>(1);
  const totalRef = useRef<number>(totalDurationMs);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    totalRef.current = totalDurationMs;
  }, [totalDurationMs]);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastFrameRef.current = null;
  }, []);

  const tick = useCallback(
    (now: number) => {
      const last = lastFrameRef.current;
      lastFrameRef.current = now;
      const total = totalRef.current;
      if (last !== null) {
        const dt = now - last;
        setCurrentTimeMs((prev) => {
          const next = prev + dt * speedRef.current;
          if (next >= total) {
            return total;
          }
          return next;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [],
  );

  useEffect(() => {
    if (!isPlaying) {
      stopRaf();
      return;
    }
    lastFrameRef.current = null;
    rafRef.current = requestAnimationFrame(tick);
    return stopRaf;
  }, [isPlaying, tick, stopRaf]);

  // Auto-pause once we hit the end.
  useEffect(() => {
    if (isPlaying && currentTimeMs >= totalDurationMs) {
      setIsPlaying(false);
    }
  }, [isPlaying, currentTimeMs, totalDurationMs]);

  const play = useCallback(() => {
    setCurrentTimeMs((prev) => {
      // If we're at the end, restart from 0 on play.
      if (prev >= totalRef.current && totalRef.current > 0) return 0;
      return prev;
    });
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(totalDurationMs, ms));
      setCurrentTimeMs(clamped);
    },
    [totalDurationMs],
  );

  const setSpeed = useCallback((s: ReplaySpeed) => {
    setSpeedState(s);
  }, []);

  const currentEventIndex = useMemo(
    () => findEventIndexAt(offsets, currentTimeMs),
    [offsets, currentTimeMs],
  );

  const replayState = snapshots[currentEventIndex + 1] ?? initialState;

  return {
    replayState,
    currentTimeMs,
    totalDurationMs,
    currentEventIndex,
    isPlaying,
    speed,
    play,
    pause,
    seek,
    setSpeed,
  };
}
