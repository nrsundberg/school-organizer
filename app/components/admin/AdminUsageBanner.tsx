import type { UsageSnapshot } from "~/lib/plan-usage-types";
import { hardCeiling, warnThreshold } from "~/lib/plan-limits";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";

type Props = { usage: UsageSnapshot };

export function AdminUsageBanner({ usage }: Props) {
  const { t } = useTranslation("admin");
  const { counts, limits, graceExpiredOverCap, graceActive, shouldWarn, overCap } =
    usage;
  if (!limits) return null;

  const dims = [
    { key: "students" as const, labelKey: "usageBanner.students" },
    { key: "families" as const, labelKey: "usageBanner.families" },
    { key: "classrooms" as const, labelKey: "usageBanner.classrooms" },
  ];

  const lines = dims
    .map(({ key, labelKey }) => {
      const cap = limits[key];
      const n = counts[key];
      const pct = cap > 0 ? Math.round((n / cap) * 100) : 0;
      return t("usageBanner.line", {
        label: t(labelKey),
        n,
        cap,
        pct,
        warn: warnThreshold(cap),
        ceiling: hardCeiling(cap),
      });
    })
    .join(" · ");

  let tone: "amber" | "red" | "blue" = "amber";
  let title: string;
  if (graceExpiredOverCap) {
    tone = "red";
    title = t("usageBanner.graceExpired");
  } else if (overCap && graceActive) {
    tone = "blue";
    title = t("usageBanner.graceActive");
  } else if (overCap) {
    tone = "amber";
    title = t("usageBanner.overCap");
  } else if (shouldWarn) {
    title = t("usageBanner.warn");
  } else {
    return null;
  }

  const bg =
    tone === "red"
      ? "bg-red-950/90 border-red-500/40"
      : tone === "blue"
        ? "bg-sky-950/80 border-sky-500/35"
        : "bg-amber-950/70 border-amber-500/35";

  return (
    <div className={`border-b px-4 py-2.5 text-sm ${bg}`}>
      <p className="font-medium text-white">{title}</p>
      <p className="mt-1 text-white/75">{lines}</p>
      <p className="mt-2">
        <Link to="/pricing" className="text-[#E9D500] underline underline-offset-2 hover:text-[#f5e047]">
          {t("usageBanner.viewPlans")}
        </Link>
      </p>
    </div>
  );
}
