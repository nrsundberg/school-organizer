// Replay-side companion to <LiveViewerRoster>: as the user scrubs the
// drill timeline, this component renders the roster captured by the
// presence-snapshot alarm at that moment, plus a horizontal heat strip
// showing per-sample viewer count so attention spikes are visible at a
// glance.
//
// Pure presentational module — no fetching. The route loader hydrates
// `samples` from `DrillRunPresenceSample` rows and the parent passes
// `currentTimeMs` from `useDrillReplay` (so this track scrubs in lockstep
// with `<ReplayTimeline>`).

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";
import { formatActorLabel } from "~/domain/auth/format-actor";
import { findActiveSampleIndex } from "./presence-sample-aggregate";

export type ReplayViewerEntry = {
  userId: string;
  label: string;
  onBehalfOfUserId: string | null;
  onBehalfOfLabel: string | null;
  color: string;
};

export type ReplayViewerSample = {
  // ms relative to drill start. Samples must be sorted ascending.
  occurredAtMs: number;
  viewers: ReplayViewerEntry[];
  guestCount: number;
};

export type ReplayViewerTrackProps = {
  samples: ReplayViewerSample[];
  currentTimeMs: number;
  totalDurationMs: number;
};

// Same hash → hsl mapping `LiveViewerRoster.tsx` uses for its in-component
// fallback. Replay rows already carry `color` from the snapshot, but a
// historical row whose color was empty can still render a stable
// per-userId tone. Duplicated here (rather than imported from the Live
// component) to keep this module decoupled — it's only 6 lines.
function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return `hsl(${h % 360} 70% 60%)`;
}

function initialsOf(label: string): string {
  const parts = label
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ViewerChip({ entry }: { entry: ReplayViewerEntry }) {
  const tooltip = formatActorLabel(
    entry.label,
    entry.onBehalfOfLabel,
    entry.label,
  );
  const initialsSource = entry.label || entry.onBehalfOfLabel || "";
  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white shadow-sm"
      style={{ backgroundColor: entry.color || colorFor(entry.userId) }}
    >
      {initialsOf(initialsSource)}
    </span>
  );
}

export function ReplayViewerTrack({
  samples,
  currentTimeMs,
  totalDurationMs,
}: ReplayViewerTrackProps) {
  const { t } = useTranslation("admin");

  // `findActiveSampleIndex` assumes `samples` is sorted ascending by
  // `occurredAtMs`. The loader sorts before passing in, but defensively
  // sort here too so a re-render with shuffled props doesn't desync the
  // chip list from the heat strip highlight.
  const sortedSamples = useMemo(
    () => [...samples].sort((a, b) => a.occurredAtMs - b.occurredAtMs),
    [samples],
  );

  const activeIndex = useMemo(
    () => findActiveSampleIndex(sortedSamples, currentTimeMs),
    [sortedSamples, currentTimeMs],
  );

  // Active sample (or null if scrub time precedes any sample).
  const active =
    activeIndex >= 0 && activeIndex < sortedSamples.length
      ? sortedSamples[activeIndex]
      : null;

  // Empty-state: no presence samples at all (run pre-W4 or no viewers
  // ever connected). Nothing useful to show; render a quiet hint.
  if (sortedSamples.length === 0) {
    return (
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold text-white mb-2">
          {t("drillsHistory.replay.viewerTrack.heading", {
            defaultValue: "Viewers",
          })}
        </h2>
        <p className="text-white/40 text-sm">
          {t("drillsHistory.replay.viewerTrack.empty", {
            defaultValue: "No viewer snapshots were captured for this run.",
          })}
        </p>
      </section>
    );
  }

  // Heat-strip max for proportional height. Floor at 1 so a 0-viewer span
  // doesn't divide-by-zero / render full-height bars.
  const peakCount = Math.max(
    1,
    ...sortedSamples.map((s) => s.viewers.length + s.guestCount),
  );

  // Total duration floor: a same-instant run (extremely short) would
  // otherwise produce NaN positions. Use the last sample's offset as the
  // span width fallback.
  const lastSampleMs =
    sortedSamples[sortedSamples.length - 1]?.occurredAtMs ?? 0;
  const spanMs = Math.max(totalDurationMs, lastSampleMs, 1);

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">
          {t("drillsHistory.replay.viewerTrack.heading", {
            defaultValue: "Viewers",
          })}
        </h2>
        {active && (
          <span className="text-xs text-white/40">
            {t("drillsHistory.replay.viewerTrack.atOffset", {
              defaultValue: "+{{seconds}}s",
              seconds: Math.floor(active.occurredAtMs / 1000),
            })}
          </span>
        )}
      </div>

      {active ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {active.viewers.length === 0 && active.guestCount === 0 ? (
            <span className="text-xs text-white/40">
              {t("drillsHistory.replay.viewerTrack.noneAtMoment", {
                defaultValue: "Nobody was watching at this moment.",
              })}
            </span>
          ) : (
            <>
              {active.viewers.map((v) => (
                <ViewerChip key={v.userId} entry={v} />
              ))}
              {active.guestCount > 0 && (
                <span
                  className="inline-flex h-6 items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 text-[11px] font-medium text-white/80"
                  title={t("drillsHistory.replay.viewerTrack.guestsTooltip", {
                    defaultValue: "Anonymous viewer-pin guests",
                  })}
                >
                  <Eye className="h-3 w-3" aria-hidden="true" />
                  {t("drillsHistory.replay.viewerTrack.guestsLabel", {
                    defaultValue: "{{count}} viewer",
                    defaultValue_other: "{{count}} viewers",
                    count: active.guestCount,
                  })}
                </span>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="text-white/40 text-sm">
          {t("drillsHistory.replay.viewerTrack.preFirst", {
            defaultValue: "No snapshot yet at this point in the run.",
          })}
        </p>
      )}

      {/* Heat strip: one bar per sample, height ∝ viewers + guests. */}
      <div
        className="mt-4 flex h-8 items-end gap-[2px]"
        role="img"
        aria-label={t("drillsHistory.replay.viewerTrack.heatStripLabel", {
          defaultValue: "Viewer count over time",
        })}
      >
        {sortedSamples.map((s, i) => {
          const total = s.viewers.length + s.guestCount;
          const heightPct = Math.max(8, (total / peakCount) * 100);
          const isActive = i === activeIndex;
          // Position the bar's flex-basis proportional to its time slot
          // so spacing reflects real elapsed time. Each bar gets at least
          // 4px so a long drill with 100+ samples doesn't collapse to
          // invisible slivers.
          const widthPct = Math.max(0.5, (1 / sortedSamples.length) * 100);
          return (
            <span
              key={`${s.occurredAtMs}-${i}`}
              className={`block rounded-sm ${
                isActive
                  ? "bg-amber-300"
                  : total === 0
                    ? "bg-white/10"
                    : "bg-emerald-400/60"
              }`}
              style={{
                height: `${heightPct}%`,
                flex: `${widthPct} 0 4px`,
              }}
              title={t("drillsHistory.replay.viewerTrack.heatBarTooltip", {
                defaultValue: "+{{seconds}}s · {{count}}",
                seconds: Math.floor(s.occurredAtMs / 1000),
                count: total,
              })}
            />
          );
        })}
        {/* Overlay marker for end-of-drill so an early-end + long-tail of
            scrub doesn't mislead. */}
        {totalDurationMs > 0 && spanMs > 0 && (
          <span aria-hidden="true" className="sr-only">
            {totalDurationMs}
          </span>
        )}
      </div>
    </section>
  );
}
