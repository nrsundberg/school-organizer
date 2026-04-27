import { useMemo, useRef } from "react";
import { Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReplayEvent, ReplaySpeed } from "./useDrillReplay";
import type { DrillEventKind } from "./types";

const SPEEDS: readonly ReplaySpeed[] = [0.5, 1, 2, 4, 8] as const;

const TIMELINE_BUCKETS = 100;

export type ReplayTimelineProps = {
  startedAtIso: string;
  endedAtIso: string;
  events: ReplayEvent[];
  currentTimeMs: number;
  totalDurationMs: number;
  isPlaying: boolean;
  speed: ReplaySpeed;
  onSeek: (ms: number) => void;
  onPlayToggle: () => void;
  onSpeedChange: (s: ReplaySpeed) => void;
};

function formatOffset(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `+${m}:${s.toString().padStart(2, "0")}`;
}

function dotClassForKind(kind: DrillEventKind): string {
  if (
    kind === "started" ||
    kind === "paused" ||
    kind === "resumed" ||
    kind === "ended"
  ) {
    return "bg-white/60";
  }
  if (kind === "cell_toggled") return "bg-blue-400";
  if (kind === "notes_changed") return "bg-amber-400";
  if (
    kind === "action_added" ||
    kind === "action_edited" ||
    kind === "action_toggled" ||
    kind === "action_removed"
  ) {
    return "bg-emerald-400";
  }
  // Per-classroom attestation overlay — distinct teal so reviewers can spot
  // which moments were "Mrs. Smith attested" vs cell flips at a glance.
  if (kind === "row_attested" || kind === "row_unattested") {
    return "bg-teal-400";
  }
  return "bg-white/40";
}

type Bucket = {
  slot: number;
  offsetMs: number;
  kind: DrillEventKind;
  count: number;
  firstIndex: number;
};

export function ReplayTimeline({
  startedAtIso,
  endedAtIso: _endedAtIso,
  events,
  currentTimeMs,
  totalDurationMs,
  isPlaying,
  speed,
  onSeek,
  onPlayToggle,
  onSpeedChange,
}: ReplayTimelineProps) {
  const { t } = useTranslation("admin");
  const trackRef = useRef<HTMLDivElement | null>(null);
  const startMs = useMemo(() => new Date(startedAtIso).getTime(), [startedAtIso]);

  const buckets = useMemo<Bucket[]>(() => {
    if (totalDurationMs <= 0) return [];
    const slots = new Map<number, Bucket>();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const t = new Date(ev.occurredAt).getTime() - startMs;
      const offsetMs = Math.max(0, Math.min(totalDurationMs, t));
      const slot = Math.min(
        TIMELINE_BUCKETS - 1,
        Math.floor((offsetMs / totalDurationMs) * TIMELINE_BUCKETS),
      );
      const existing = slots.get(slot);
      if (existing) {
        existing.count += 1;
      } else {
        slots.set(slot, {
          slot,
          offsetMs,
          kind: ev.kind,
          count: 1,
          firstIndex: i,
        });
      }
    }
    return Array.from(slots.values()).sort((a, b) => a.slot - b.slot);
  }, [events, startMs, totalDurationMs]);

  const minuteTicks = useMemo(() => {
    if (totalDurationMs <= 0) return [];
    const ticks: number[] = [];
    const oneMin = 60_000;
    for (let m = oneMin; m < totalDurationMs; m += oneMin) {
      ticks.push(m);
    }
    return ticks;
  }, [totalDurationMs]);

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (totalDurationMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    onSeek(ratio * totalDurationMs);
  };

  const scrubberLeftPct =
    totalDurationMs > 0
      ? Math.max(0, Math.min(100, (currentTimeMs / totalDurationMs) * 100))
      : 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onPlayToggle}
          aria-label={
            isPlaying
              ? t("drillsHistory.replay.timeline.pause")
              : t("drillsHistory.replay.timeline.play")
          }
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" />
          )}
        </button>

        <div className="font-mono text-sm text-white/80 tabular-nums">
          {formatOffset(currentTimeMs)} / {formatOffset(totalDurationMs)}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {SPEEDS.map((s) => {
            const active = s === speed;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onSpeedChange(s)}
                aria-pressed={active}
                className={
                  "rounded-md px-2 py-1 text-xs font-semibold transition-colors " +
                  (active
                    ? "bg-white text-black"
                    : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")
                }
              >
                {s}x
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={trackRef}
        onClick={handleTrackClick}
        role="slider"
        aria-label={t("drillsHistory.replay.timeline.scrubberLabel")}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.floor(totalDurationMs / 1000))}
        aria-valuenow={Math.max(0, Math.floor(currentTimeMs / 1000))}
        tabIndex={0}
        className="relative h-12 mt-4 bg-white/5 rounded-md cursor-pointer"
      >
        {minuteTicks.map((ms) => (
          <div
            key={`tick-${ms}`}
            className="absolute top-0 bottom-0 w-px bg-white/10 pointer-events-none"
            style={{ left: `${(ms / totalDurationMs) * 100}%` }}
          />
        ))}

        {buckets.map((b) => {
          const leftPct = (b.offsetMs / totalDurationMs) * 100;
          const ev = events[b.firstIndex];
          const label = t(`drillsHistory.replay.events.${ev.kind}`, {
            defaultValue: ev.kind,
          });
          return (
            <button
              key={`bucket-${b.slot}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSeek(b.offsetMs);
              }}
              aria-label={
                b.count > 1
                  ? t("drillsHistory.replay.timeline.clusterLabel", {
                      count: b.count,
                      label,
                    })
                  : label
              }
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
              style={{ left: `${leftPct}%` }}
            >
              {b.count > 1 && (
                <span className="mb-0.5 rounded-full bg-white/80 px-1 text-[9px] font-bold leading-none text-black">
                  {b.count}
                </span>
              )}
              <span
                className={
                  "block w-2 h-2 rounded-full ring-1 ring-black/40 " +
                  dotClassForKind(b.kind)
                }
              />
            </button>
          );
        })}

        <div
          className="absolute top-0 bottom-0 w-px bg-white pointer-events-none"
          style={{ left: `${scrubberLeftPct}%` }}
        />
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-white/40">
        <span>{formatOffset(0)}</span>
        <span>{formatOffset(totalDurationMs)}</span>
      </div>
    </div>
  );
}
