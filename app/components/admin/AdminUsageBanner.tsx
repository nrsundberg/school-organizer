import type { UsageSnapshot } from "~/lib/plan-usage-types";
import { hardCeiling, warnThreshold } from "~/lib/plan-limits";
import { Link } from "react-router";

type Props = { usage: UsageSnapshot };

export function AdminUsageBanner({ usage }: Props) {
  const { counts, limits, worstLevel, graceExpiredOverCap, graceActive, shouldWarn, overCap } =
    usage;
  if (!limits) return null;

  const dims = [
    { key: "students" as const, label: "Students" },
    { key: "families" as const, label: "Families" },
    { key: "classrooms" as const, label: "Classrooms" },
  ];

  const lines = dims
    .map(({ key, label }) => {
      const cap = limits[key];
      const n = counts[key];
      const pct = cap > 0 ? Math.round((n / cap) * 100) : 0;
      return `${label}: ${n} / ${cap} (${pct}%) — warn ≥${warnThreshold(cap)}, max ${hardCeiling(cap)} during grace`;
    })
    .join(" · ");

  let tone: "amber" | "red" | "blue" = "amber";
  let title: string;
  if (graceExpiredOverCap) {
    tone = "red";
    title =
      "Plan limit grace period ended — reduce usage (students, families, or classrooms) or upgrade your plan.";
  } else if (overCap && graceActive) {
    tone = "blue";
    title =
      "You’re above your plan limits — 30-day grace active. You can grow up to 110% of each cap, then upgrade or trim data.";
  } else if (overCap) {
    tone = "amber";
    title = "You’re over a plan limit — a grace period will apply on the next sync.";
  } else if (shouldWarn) {
    title = "You’re approaching a plan limit (80% or more on one dimension).";
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
          View plans
        </Link>
      </p>
    </div>
  );
}
