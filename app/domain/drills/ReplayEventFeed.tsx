import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ReplayEvent } from "./useDrillReplay";
import { formatDrillEvent } from "./replay";

export type ReplayEventFeedProps = {
  events: ReplayEvent[];
  currentEventIndex: number;
  startedAtIso: string;
  onSeek: (ms: number) => void;
};

function formatOffset(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `+${m}:${s.toString().padStart(2, "0")}`;
}

export function ReplayEventFeed({
  events,
  currentEventIndex,
  startedAtIso,
  onSeek,
}: ReplayEventFeedProps) {
  const { t } = useTranslation("admin");
  const startMs = useMemo(() => new Date(startedAtIso).getTime(), [startedAtIso]);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    if (currentEventIndex < 0) return;
    const el = itemRefs.current[currentEventIndex];
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [currentEventIndex]);

  if (events.length === 0) {
    return (
      <section className="rounded-xl border border-white/10 bg-white/5 p-4 max-h-[600px] overflow-y-auto">
        <p className="text-center text-sm text-white/40 py-8">
          {t("drillsHistory.replay.events.empty")}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4 max-h-[600px] overflow-y-auto">
      <ul className="flex flex-col gap-2">
        {events.map((ev, i) => {
          const offsetMs = Math.max(0, new Date(ev.occurredAt).getTime() - startMs);
          const label = formatDrillEvent(ev.payload, t);
          const actorName =
            ev.actor?.name ?? t("drillsHistory.replay.events.unknownActor");
          const viaLine = ev.onBehalfOf
            ? t("drillsHistory.replay.events.viaImpersonator", {
                admin: ev.onBehalfOf.name,
              })
            : null;
          const isCurrent = i === currentEventIndex;

          return (
            <li
              key={ev.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
            >
              <button
                type="button"
                onClick={() => onSeek(offsetMs)}
                className={
                  "w-full text-left rounded-lg border border-white/10 bg-white/5 px-3 py-2 transition-colors hover:bg-white/10 " +
                  (isCurrent ? "ring-2 ring-blue-400/50" : "")
                }
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-white/50 tabular-nums shrink-0">
                    {formatOffset(offsetMs)}
                  </span>
                  <span className="text-sm text-white">{label}</span>
                </div>
                <div className="mt-1 text-xs text-white/50">
                  {actorName}
                  {viaLine ? <span className="ml-1">{viaLine}</span> : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
