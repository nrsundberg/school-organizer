import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import type { LoaderFunctionArgs } from "react-router";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { getStatusPageData } from "~/domain/status/service.server";
import { StatusPill } from "~/components/status/StatusPill";
import { UptimeGrid } from "~/components/status/UptimeGrid";
import { IncidentList } from "~/components/status/IncidentList";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";
import type {
  ComponentStatus,
  SectionId,
  StatusPageComponent,
} from "~/domain/status/types";

export function meta({ data }: { data?: { metaTitle?: string; metaDescription?: string } }) {
  return [
    { title: data?.metaTitle ?? "Status — Pickup Roster" },
    {
      name: "description",
      content:
        data?.metaDescription ??
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

export async function loader({ request, context }: LoaderFunctionArgs) {
  const data = await getStatusPageData(context);
  // Localize meta tags at the edge — the meta() helper runs before the
  // component mounts so we can't use useTranslation there.
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "common");
  return {
    ...data,
    metaTitle: t("status.metaTitle"),
    metaDescription: t("status.metaDescription"),
  };
}

const SECTION_ORDER: SectionId[] = [
  "application",
  "data",
  "email",
  "payments",
  "tenants",
];

export default function StatusPage() {
  const { t } = useTranslation("common");
  const loaderData = useLoaderData<typeof loader>();
  const { components, activeIncidents, overall, renderedAt } = loaderData;

  const sectionTitles: Record<SectionId, string> = {
    application: t("status.sections.application"),
    data: t("status.sections.data"),
    email: t("status.sections.email"),
    payments: t("status.sections.payments"),
    tenants: t("status.sections.tenants"),
  };

  const grouped = SECTION_ORDER.map((section) => ({
    section,
    title: sectionTitles[section],
    items: components.filter((c) => c.section === section),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-4xl px-4 py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold sm:text-4xl">
              {t("status.title")}
            </h1>
            <p className="mt-2 text-sm text-white/60">
              {t("status.description")}
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
          {t("status.renderedAt", { when: formatRenderedAt(renderedAt) })}
        </footer>
      </div>
    </div>
  );
}

function ComponentRow({ component }: { component: StatusPageComponent }) {
  const { t } = useTranslation("common");
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
        <span>{t("status.ninetyDaysAgo")}</span>
        <span>{t("status.today")}</span>
      </div>
    </li>
  );
}

function OverallBanner({ status }: { status: ComponentStatus }) {
  const { t } = useTranslation("common");
  const { label, bgClass } = overallStyle(status, t);
  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-4 py-3 ${bgClass}`}
    >
      <StatusPill status={status} />
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function overallStyle(
  status: ComponentStatus,
  t: TFn,
): {
  label: string;
  bgClass: string;
} {
  switch (status) {
    case "operational":
      return {
        label: t("status.overall.operational"),
        bgClass: "bg-emerald-500/10 ring-1 ring-inset ring-emerald-400/25",
      };
    case "degraded":
      return {
        label: t("status.overall.degraded"),
        bgClass: "bg-amber-500/10 ring-1 ring-inset ring-amber-400/25",
      };
    case "outage":
      return {
        label: t("status.overall.outage"),
        bgClass: "bg-red-500/10 ring-1 ring-inset ring-red-400/25",
      };
    case "unknown":
    default:
      return {
        label: t("status.overall.unknown"),
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
