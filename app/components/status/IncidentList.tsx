import type { ActiveIncident } from "~/domain/status/types";
import { StatusPill } from "./StatusPill";

/**
 * Active (unresolved) incidents, grouped at the top of the page. Rendered
 * only when there's at least one open incident.
 */
export function IncidentList({ incidents }: { incidents: ActiveIncident[] }) {
  if (incidents.length === 0) return null;
  return (
    <section className="rounded-2xl border border-amber-400/25 bg-amber-500/5 p-5">
      <h2 className="text-lg font-bold text-amber-200">Active incidents</h2>
      <ul className="mt-4 space-y-3">
        {incidents.map((i) => (
          <li
            key={i.id}
            className="flex flex-col gap-2 rounded-xl border border-white/10 bg-[#151a1a] p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <StatusPill status={i.severity} size="sm" />
                <span className="text-sm font-semibold text-white">
                  {i.componentName}
                </span>
              </div>
              <p className="mt-1 text-sm text-white/75">{i.title}</p>
            </div>
            <time
              className="shrink-0 text-xs text-white/50"
              dateTime={i.startedAt}
            >
              Since {formatStarted(i.startedAt)}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatStarted(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}
