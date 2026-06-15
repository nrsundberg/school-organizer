import { useTranslation } from "react-i18next";
import type {
  DrillAudience,
  DrillMode,
  DrillRunStatus,
} from "~/domain/drills/types";

/**
 * Visual badge for a drill run's mode. Real events ("ACTUAL") get a
 * high-contrast amber treatment so a glance at the history list makes it
 * obvious which rows are actual incidents vs planned drills.
 *
 * Shared by the drills history list and the run-detail/replay page so the two
 * views stay visually identical.
 */
export function ModeChip({ mode }: { mode: DrillMode }) {
  const { t } = useTranslation("admin");
  const cls =
    mode === "ACTUAL"
      ? "bg-amber-500/25 text-amber-100 border border-amber-400/50"
      : mode === "FALSE_ALARM"
        ? "bg-purple-500/20 text-purple-100 border border-purple-400/40"
        : "bg-white/10 text-white/70 border border-white/20";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {t(`drills.mode.${mode === "ACTUAL" ? "actualShort" : mode === "FALSE_ALARM" ? "falseAlarmShort" : "drillShort"}`)}
    </span>
  );
}

/**
 * Visual badge for a drill run's status. Each status maps to a distinct color,
 * and LIVE additionally gets a pulsing dot — the pulse cue is doubled with a
 * leading dot shape so color-blind and screen-reader users still perceive the
 * "live" state, not just a hue.
 *
 * Shared by the drills history list and the run-detail/replay page.
 */
export function StatusChip({ status }: { status: DrillRunStatus }) {
  const { t } = useTranslation("admin");
  const cls =
    status === "LIVE"
      ? "bg-rose-600/20 text-rose-200 border border-rose-500/40"
      : status === "PAUSED"
        ? "bg-amber-500/20 text-amber-200 border border-amber-500/40"
        : status === "ENDED"
          ? "bg-emerald-600/20 text-emerald-200 border border-emerald-500/40"
          : "bg-white/10 text-white/70 border border-white/20";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {status === "LIVE" && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse"
        />
      )}
      {t(`drillsHistory.status.${status}`)}
    </span>
  );
}

/**
 * Visual badge for a drill run's audience — "staff only" vs "everyone".
 *
 * Shared by the drills history list and the run-detail/replay page.
 */
export function AudienceChip({ audience }: { audience: DrillAudience }) {
  const { t } = useTranslation("admin");
  const cls =
    audience === "STAFF_ONLY"
      ? "bg-blue-500/20 text-blue-200 border border-blue-500/40"
      : "bg-white/10 text-white/70 border border-white/20";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {audience === "STAFF_ONLY"
        ? t("drillsHistory.replay.audience.staffOnly")
        : t("drillsHistory.replay.audience.everyone")}
    </span>
  );
}
