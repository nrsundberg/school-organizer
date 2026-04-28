import type { ReactNode } from "react";

export type StatCardTone = "default" | "warning" | "danger" | "success" | "info";

const TONE_CLASSES: Record<StatCardTone, string> = {
  default: "border-white/8 bg-white/[0.04]",
  warning: "border-amber-400/30 bg-amber-400/[0.08]",
  danger: "border-rose-400/30 bg-rose-400/[0.08]",
  success: "border-emerald-400/30 bg-emerald-400/[0.08]",
  info: "border-blue-400/30 bg-blue-400/[0.08]",
};

const VALUE_TONE: Record<StatCardTone, string> = {
  default: "text-white",
  warning: "text-amber-100",
  danger: "text-rose-100",
  success: "text-emerald-100",
  info: "text-blue-100",
};

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  /** Optional leading icon. */
  icon?: ReactNode;
  tone?: StatCardTone;
  className?: string;
}

export function StatCard({
  label,
  value,
  caption,
  icon,
  tone = "default",
  className = "",
}: StatCardProps) {
  return (
    <div
      className={[
        "rounded-xl border p-4",
        TONE_CLASSES[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/50">
        {icon ? <span className="inline-flex shrink-0">{icon}</span> : null}
        <span>{label}</span>
      </div>
      <p className={`mt-2 text-2xl font-semibold ${VALUE_TONE[tone]}`}>{value}</p>
      {caption ? (
        <p className="mt-1 text-xs text-white/55">{caption}</p>
      ) : null}
    </div>
  );
}

export default StatCard;
