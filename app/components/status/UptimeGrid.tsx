import { useTranslation } from "react-i18next";
import type { UptimeDay } from "~/domain/status/types";

/**
 * 90-day uptime strip. One cell per UTC day, oldest on the left, today on the
 * right. Colour maps to the worst status seen that day. Gray = no data. No
 * latency numbers are exposed on hover per product spec.
 */
export function UptimeGrid({ days }: { days: UptimeDay[] }) {
  const { t } = useTranslation("common");
  return (
    <div
      // overflow-hidden prevents a webkit-only horizontal scroll: 90 cells of
      // `flex-1 min-w-[2px]` plus 89 `gap-[2px]` exactly equals the inner
      // viewport width on iPhone 13 (390px - 32px page padding = 358px), and
      // WebKit's flex rounding pushes the last cell ~5px past the edge.
      // Cells are unlabeled visual indicators (status/title come from the
      // role="img" aria-label), so clipping is invisible to all users.
      className="flex w-full items-end gap-[2px] overflow-hidden"
      role="img"
      aria-label={t("status.uptime.ariaLabel", { summary: summarize(days, t) })}
    >
      {days.map((day) => (
        <span
          key={day.date}
          className={`h-6 flex-1 min-w-[2px] rounded-[2px] ${cellClass(day.status)}`}
          title={t("status.uptime.cellTitle", {
            date: day.date,
            label: label(day.status, t),
          })}
        />
      ))}
    </div>
  );
}

function cellClass(status: UptimeDay["status"]): string {
  switch (status) {
    case "operational":
      return "bg-emerald-400/80";
    case "degraded":
      return "bg-amber-400/85";
    case "outage":
      return "bg-red-500/85";
    case "unknown":
    default:
      return "bg-white/10";
  }
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function label(status: UptimeDay["status"], t: TFn): string {
  switch (status) {
    case "operational":
      return t("status.uptime.operational");
    case "degraded":
      return t("status.uptime.degraded");
    case "outage":
      return t("status.uptime.outage");
    case "unknown":
    default:
      return t("status.uptime.noDataLabel");
  }
}

function summarize(days: UptimeDay[], t: TFn): string {
  const total = days.length;
  const withData = days.filter((d) => d.status !== "unknown").length;
  const bad = days.filter(
    (d) => d.status === "outage" || d.status === "degraded",
  ).length;
  if (withData === 0) return t("status.uptime.noData");
  if (bad === 0)
    return t("status.uptime.allOperational", { withData, total });
  return t("status.uptime.withIncidents", { bad, withData, total });
}
