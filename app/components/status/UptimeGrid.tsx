import type { UptimeDay } from "~/domain/status/types";

/**
 * 90-day uptime strip. One cell per UTC day, oldest on the left, today on the
 * right. Colour maps to the worst status seen that day. Gray = no data. No
 * latency numbers are exposed on hover per product spec.
 */
export function UptimeGrid({ days }: { days: UptimeDay[] }) {
  return (
    <div
      className="flex w-full items-end gap-[2px]"
      role="img"
      aria-label={`90-day uptime history. ${summarize(days)}.`}
    >
      {days.map((day) => (
        <span
          key={day.date}
          className={`h-6 flex-1 min-w-[2px] rounded-[2px] ${cellClass(day.status)}`}
          title={`${day.date} — ${label(day.status)}`}
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

function label(status: UptimeDay["status"]): string {
  switch (status) {
    case "operational":
      return "operational";
    case "degraded":
      return "degraded";
    case "outage":
      return "outage";
    case "unknown":
    default:
      return "no data";
  }
}

function summarize(days: UptimeDay[]): string {
  const total = days.length;
  const withData = days.filter((d) => d.status !== "unknown").length;
  const bad = days.filter(
    (d) => d.status === "outage" || d.status === "degraded",
  ).length;
  if (withData === 0) return "No data yet";
  if (bad === 0) return `${withData} of ${total} days with data — all operational`;
  return `${bad} of ${withData} days with incidents over the last ${total} days`;
}
