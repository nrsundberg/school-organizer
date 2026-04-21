import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { getStatusPageData } from "~/domain/status/service.server";
import { StatusPill } from "~/components/status/StatusPill";
import { UptimeGrid } from "~/components/status/UptimeGrid";
import { IncidentList } from "~/components/status/IncidentList";
import type {
  ComponentStatus,
  SectionId,
  StatusPageComponent,
} from "~/domain/status/types";

export function meta() {
  return [
    { title: "Status — Pickup Roster" },
    {
      name: "description",
      content:
        "Live status of the Pickup Roster platform, including board infrastructure and third-party dependencies.",
    },
  ];
}

// Cacheable at the edge for 30s; stale-while-revalidate keeps it fast even if
// the 2-minute cron is mid-run. Keep in sync with the cron cadence.
export function headers() {
  return {
    "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=120",
  };
}

export async function loader({ context }: LoaderFunctionArgs) {
  return await getStatusPageData(context);
}

const SECTION_TITLES: Record<SectionId, string> = {
  application: "Application",
  data: "Data",
  email: "Email",
  payments: "Payments",
  tenants: "Tenants",
};

const SECTION_ORDER: SectionId[] = [
  "application",
  "data",
  "email",
  "payments",
  "tenants",
];

export default function StatusPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { components, activeIncidents, overall, renderedAt } = loaderData;

  const grouped = SECTION_ORDER.map((section) => ({
    section,
    title: SECTION_TITLES[section],
    items: components.filter((c) => c.section === section),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-4xl px-4 py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold sm:text-4xl">
              Pickup Roster Status
            </h1>
            <p className="mt-2 text-sm text-white/60">
              Live health of the platform and its third-party dependencies.
            </p>
          </div>
          <div className="shrink-0">
            <OverallBanner status={overall} />
          </div>
        </header>

        {activeIncidents.length > 0 ? (
          <div className="mt-10">
            <IncidentList incidents={activeIncidents} />
          </div>
        ) : null}

        <div className="mt-10 space-y-8">
          {grouped.map((group) => (
            <section
              key={group.section}
              className="rounded-2xl border border-white/10 bg-[#151a1a]"
            >
              <h2 className="border-b border-white/10 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-white/60">
                {group.title}
              </h2>
              <ul className="divide-y divide-white/5">
                {group.items.map((component) => (
                  <ComponentRow key={component.id} component={component} />
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="mt-10 text-xs text-white/40">
          Rendered {formatRenderedAt(renderedAt)}. Updated every 2 minutes.
        </footer>
      </div>
    </div>
  );
}

function ComponentRow({ component }: { component: StatusPageComponent }) {
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{component.name}</div>
          <div className="mt-0.5 text-xs text-white/50">
            {component.description}
          </div>
          {component.note ? (
            <div className="mt-1 text-xs italic text-white/45">
              {component.note}
            </div>
          ) : null}
        </div>
        <div className="shrink-0">
          <StatusPill status={component.currentStatus} />
        </div>
      </div>
      <UptimeGrid days={component.uptime90d} />
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-white/35">
        <span>90 days ago</span>
        <span>Today</span>
      </div>
    </li>
  );
}

function OverallBanner({ status }: { status: ComponentStatus }) {
  const { label, bgClass } = overallStyle(status);
  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-4 py-3 ${bgClass}`}
    >
      <StatusPill status={status} />
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

function overallStyle(status: ComponentStatus): {
  label: string;
  bgClass: string;
} {
  switch (status) {
    case "operational":
      return {
        label: "All systems operational",
        bgClass: "bg-emerald-500/10 ring-1 ring-inset ring-emerald-400/25",
      };
    case "degraded":
      return {
        label: "Degraded performance",
        bgClass: "bg-amber-500/10 ring-1 ring-inset ring-amber-400/25",
      };
    case "outage":
      return {
        label: "Major outage",
        bgClass: "bg-red-500/10 ring-1 ring-inset ring-red-400/25",
      };
    case "unknown":
    default:
      return {
        label: "Status collecting",
        bgClass: "bg-white/5 ring-1 ring-inset ring-white/15",
      };
  }
}

function formatRenderedAt(iso: string): string {
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
